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

local function request_translation(env, text)
  if env.pending[text] then return end
  local maintenance = io.open(env.queue_lock_path, "r")
  if maintenance then
    maintenance:close()
    return
  end
  local file = io.open(env.queue_path, "a")
  if not file then return end
  file:write(text:gsub("[\t\r\n]", " "), "\n")
  file:close()
  env.pending[text] = true
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
  env.pending = {}
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
  local index = 0
  for candidate in input:iter() do
    index = index + 1
    local text = candidate.text
    local english, source = lookup_translation(env, text)
    if index <= env.max_candidates and english then
      env.pending[text] = nil
      local prefix = source == "ai" and "AI · " or ""
      local display = truncate_text(prefix .. english, env.max_comment_length)
      local comment = append_comment(candidate, display)
      -- Keep the original candidate text so confirming it only commits Chinese.
      -- English lives in the comment field and is visible only in the candidate UI.
      yield(ShadowCandidate(candidate, candidate.type, text, comment))
    else
      if index <= env.max_candidates
        and has_han(text)
        and candidate.type ~= "mixed_input" then
        request_translation(env, text)
        local comment = append_comment(candidate, "AI 翻译中…")
        yield(ShadowCandidate(candidate, candidate.type, text, comment))
      else
        yield(candidate)
      end
    end
  end
end

filter._reload_cache = reload_cache
filter._truncate_text = truncate_text

return filter
