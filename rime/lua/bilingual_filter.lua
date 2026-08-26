local filter = {}

local function join_path(base, name)
  return base .. "/bilingual/" .. name
end

local function read_version(path)
  local file = io.open(path, "r")
  if not file then return "" end
  local value = file:read("*l") or ""
  file:close()
  return value
end

local function load_tsv(path)
  local target = {}
  local file = io.open(path, "r")
  if not file then return target end
  for line in file:lines() do
    if line:sub(1, 1) ~= "#" then
      local source, english = line:match("^([^\t]+)\t(.+)$")
      if source and english then target[source] = english end
    end
  end
  file:close()
  return target
end

local function reload_cache(env)
  local version = read_version(env.version_path)
  if env.seed_translations and version == env.version then return end
  -- CC-CEDICT is immutable during a Rime session and contains ~120k rows.
  -- Only the small override layers change when the sidecar bumps the version.
  env.seed_translations = load_tsv(env.seed_path)
  env.dynamic_translations = load_tsv(env.dynamic_path)
  env.version = version
end

local function lookup_translation(env, text)
  local english = env.dynamic_translations[text]
  if english then return english, "ai" end
  english = env.seed_translations[text]
  if english then return english, "preset" end
  return env.dictionary_translations[text], "dictionary"
end

local function truncate_text(value, limit)
  if not value or limit <= 0 then return value end
  local characters = {}
  local count = 0
  for character in value:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    count = count + 1
    if count > limit then return table.concat(characters) .. "…" end
    characters[#characters + 1] = character
  end
  return value
end

local function append_comment(candidate, value)
  local comment = candidate.comment or ""
  if comment ~= "" then return comment .. "  " .. value end
  return value
end

local function has_han(text)
  if utf8 and utf8.codes then
    for _, codepoint in utf8.codes(text) do
      if (codepoint >= 0x3400 and codepoint <= 0x9FFF)
        or (codepoint >= 0xF900 and codepoint <= 0xFAFF) then
        return true
      end
    end
    return false
  end
  return text:find("[\228-\233][\128-\191][\128-\191]") ~= nil
end

local function clean_request_text(text)
  return text:gsub("[\t\r\n]", " "):gsub("%s+", " ")
end

local function format_snapshot(texts)
  local cells = { "@snapshot" }
  for _, text in ipairs(texts) do
    cells[#cells + 1] = clean_request_text(text)
  end
  return table.concat(cells, "\t") .. "\n"
end

local function request_snapshot(env, input_code, texts)
  local signature = input_code .. "\0" .. table.concat(texts, "\0")
  if env.last_snapshot_signature == signature then return end
  local maintenance = io.open(env.queue_lock_path, "r")
  if maintenance then
    maintenance:close()
    return
  end
  local file = io.open(env.queue_path, "a")
  if not file then return end
  file:write(format_snapshot(texts))
  file:close()
  env.last_snapshot_signature = signature
end

function filter.init(env)
  local user_dir = rime_api:get_user_data_dir()
  local config = env.engine.schema.config
  env.seed_path = join_path(user_dir, "seed.tsv")
  env.dictionary_path = join_path(user_dir, "cedict.tsv")
  env.dynamic_path = join_path(user_dir, "dynamic.tsv")
  env.queue_path = join_path(user_dir, "requests.txt")
  env.queue_lock_path = join_path(user_dir, ".queue-maintenance")
  env.version_path = join_path(user_dir, "cache.version")
  env.max_candidates = config:get_int("bilingual/max_candidates") or 5
  env.max_comment_length = config:get_int("bilingual/max_comment_length") or 42
  env.last_snapshot_signature = nil
  env.version = nil
  env.dictionary_translations = load_tsv(env.dictionary_path)
  env.seed_translations = nil
  env.dynamic_translations = nil
  reload_cache(env)
end

function filter.func(input, env)
  local context = env.engine.context
  if not context:get_option("bilingual_output") then
    for candidate in input:iter() do yield(candidate) end
    return
  end

  reload_cache(env)
  local leading = {}
  local leading_emitted = false

  local function emit_leading()
    if leading_emitted then return end
    leading_emitted = true
    local decorated = {}
    local requested = {}
    for _, candidate in ipairs(leading) do
      local text = candidate.text
      local english, source = lookup_translation(env, text)
      if english then
        local prefix = source == "ai" and "AI · " or ""
        decorated[#decorated + 1] = {
          candidate = candidate,
          display = truncate_text(prefix .. english, env.max_comment_length),
        }
      elseif has_han(text) and candidate.type ~= "mixed_input" then
        requested[#requested + 1] = text
        decorated[#decorated + 1] = {
          candidate = candidate,
          display = "AI 翻译中…",
        }
      else
        decorated[#decorated + 1] = { candidate = candidate }
      end
    end

    if #requested > 0 then
      request_snapshot(env, env.engine.context.input or "", requested)
    end
    for _, item in ipairs(decorated) do
      if item.display then
        local candidate = item.candidate
        local comment = append_comment(candidate, item.display)
        yield(ShadowCandidate(
          candidate,
          candidate.type,
          candidate.text,
          comment
        ))
      else
        yield(item.candidate)
      end
    end
  end

  for candidate in input:iter() do
    if #leading < env.max_candidates then
      leading[#leading + 1] = candidate
    else
      emit_leading()
      yield(candidate)
    end
  end
  emit_leading()
end

filter._reload_cache = reload_cache
filter._truncate_text = truncate_text
filter._format_snapshot = format_snapshot

return filter
