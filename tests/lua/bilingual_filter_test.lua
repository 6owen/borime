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

io.open = original_open
os.execute("rm -rf " .. root)
print("bilingual_filter_test: ok")
