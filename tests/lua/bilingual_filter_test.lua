package.path = "./rime/lua/?.lua;" .. package.path

local root = os.tmpname()
os.remove(root)
assert(os.execute("mkdir -p " .. root .. "/bilingual"))

local function write(name, content)
  local file = assert(io.open(root .. "/bilingual/" .. name, "w"))
  file:write(content)
  file:close()
end

write("cache.version", "1\n")
write("ai.enabled", "enabled\n")
write("cedict.tsv", "法医\tforensic pathologist; forensic doctor; medical examiner\n")
write("seed.tsv", "例如\tfor example\n")
write("dynamic.tsv", "利刃\tsharp blade\n")

rime_api = { get_user_data_dir = function() return root end }

local original_open = io.open
local dictionary_opens = 0
io.open = function(path, mode)
  if path:match("cedict%.tsv$") then dictionary_opens = dictionary_opens + 1 end
  return original_open(path, mode)
end

local filter = require("bilingual_filter")
local config = { get_int = function(_, key)
  if key == "bilingual/max_candidates" then return 5 end
  if key == "bilingual/max_comment_length" then return 42 end
end }
local env = { engine = { schema = { config = config } } }
filter.init(env)
assert(dictionary_opens == 1, "dictionary must load once during init")
assert(env.queue_lock_path == root .. "/bilingual/.queue-maintenance", "queue maintenance lock path must be configured")
assert(env.ai_enabled, "the installer marker must enable AI candidate requests")

write("cache.version", "2\n")
filter._reload_cache(env)
assert(dictionary_opens == 1, "AI cache updates must not reload the large dictionary")

local shortened = filter._truncate_text("Dow Jones Industrial Average (abbr. for a very long definition)", 42)
assert(shortened == "Dow Jones Industrial Average (abbr. for a …", "long comments must be truncated deterministically")

local snapshot = filter._format_snapshot({ "找一个地方", "找一个", "招\t一个" })
assert(
  snapshot == "@snapshot\t找一个地方\t找一个\t招 一个\n",
  "candidate snapshots must preserve rank and sanitize cells"
)

env.engine.context = {
  input = "vcdygedifh",
  get_option = function(_, name) return name == "bilingual_output" end,
  properties = {},
  set_property = function(self, name, value)
    self.properties[name] = value
  end,
}
ShadowCandidate = function(_, candidate_type, text, comment)
  return { type = candidate_type, text = text, comment = comment }
end
local yielded = {}
yield = function(candidate) yielded[#yielded + 1] = candidate end
local candidates = {
  { type = "sentence", text = "找一个地方", comment = "" },
  { type = "phrase", text = "找一个", comment = "" },
  { type = "phrase", text = "招一个", comment = "" },
}
local input = { iter = function()
  local index = 0
  return function()
    index = index + 1
    return candidates[index]
  end
end }
filter.func(input, env)
assert(#yielded == 3, "the filter must preserve every candidate")
local queue = assert(original_open(root .. "/bilingual/requests.txt", "r"))
local queued_snapshot = queue:read("*a")
queue:close()
assert(
  queued_snapshot == "@snapshot\t找一个地方\t找一个\t招一个\n",
  "the filter must queue one ranked snapshot for the visible candidates"
)
assert(
  env.engine.context.properties._comment_warning == "0,1,2,100003",
  "pending AI translations must use Squirrel's warning comment color"
)
assert(
  env.engine.context.properties._comment_highlight == "100001",
  "an out-of-range sentinel must clear stale AI comment highlights"
)
assert(
  env.engine.context.properties._refresh_ui == "1",
  "semantic comment properties must request one UI-only redraw"
)

local queue_before_disabled = queued_snapshot
yielded = {}
env.ai_enabled = false
env.engine.context.input = "bukeyong"
local disabled_candidate = { type = "phrase", text = "不可用", comment = "" }
filter.func({ iter = function()
  local emitted = false
  return function()
    if emitted then return nil end
    emitted = true
    return disabled_candidate
  end
end }, env)
local disabled_queue = assert(original_open(root .. "/bilingual/requests.txt", "r"))
local queue_after_disabled = disabled_queue:read("*a")
disabled_queue:close()
assert(queue_after_disabled == queue_before_disabled, "disabled AI must not queue candidate text")
assert(yielded[1] == disabled_candidate, "disabled AI must preserve an untranslated candidate")
assert(yielded[1].comment == "", "disabled AI must not show a pending translation")
env.ai_enabled = true

assert(filter._encode_indices({ 0, 2 }, 100000) == "0,2,100000")

yielded = {}
env.engine.context.input = "lirk"
local cached_candidates = {
  { type = "phrase", text = "利刃", comment = "" },
  { type = "phrase", text = "例如", comment = "" },
}
filter.func({ iter = function()
  local index = 0
  return function()
    index = index + 1
    return cached_candidates[index]
  end
end }, env)
assert(yielded[1].comment == "sharp blade", "AI text must not contain an AI prefix")
assert(yielded[2].comment == "for example", "preset text must remain unchanged")
assert(
  env.engine.context.properties._comment_highlight == "0,100001",
  "cached AI translations must use Squirrel's accent comment color"
)
assert(
  env.engine.context.properties._comment_warning == "100003",
  "a new snapshot must clear stale warning rows"
)

io.open = original_open
os.execute("rm -rf " .. root)
print("bilingual_filter_test: ok")
