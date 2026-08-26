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

io.open = original_open
os.execute("rm -rf " .. root)
print("bilingual_filter_test: ok")
