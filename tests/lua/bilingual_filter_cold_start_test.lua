package.path = "./rime/lua/?.lua;" .. package.path

local default_user_dir
if package.config:sub(1, 1) == "\\" then
  default_user_dir = (os.getenv("APPDATA") or "") .. "/Rime"
else
  default_user_dir = (os.getenv("HOME") or "") .. "/Library/Rime"
end
local user_dir = os.getenv("RIME_USER_DIR") or default_user_dir
local budget_ms = tonumber(os.getenv("RIME_COLD_START_BUDGET_MS")) or 16.7
local iterations = tonumber(os.getenv("RIME_COLD_START_ITERATIONS")) or 7
local skip_dictionary = os.getenv("RIME_COLD_START_SKIP_DICTIONARY") == "1"
assert(iterations >= 2, "RIME_COLD_START_ITERATIONS must be at least 2")

local dictionary_path = user_dir .. "/bilingual/cedict.tsv"
if not skip_dictionary then
  local dictionary = assert(
    io.open(dictionary_path, "r"),
    "missing deployed dictionary: " .. dictionary_path
  )
  dictionary:close()
else
  local original_open = io.open
  io.open = function(path, mode)
    if path == dictionary_path then return nil end
    return original_open(path, mode)
  end
end

rime_api = {
  get_user_data_dir = function()
    return user_dir
  end,
}

local config = {
  get_int = function(_, key)
    if key == "bilingual/max_candidates" then return 5 end
    if key == "bilingual/max_comment_length" then return 42 end
  end,
}

local filter = require("bilingual_filter")
local timings = {}
for index = 1, iterations do
  collectgarbage("collect")
  local env = { engine = { schema = { config = config } } }
  local started_at = os.clock()
  filter.init(env)
  timings[index] = (os.clock() - started_at) * 1000
end

local first_ms = timings[1]
local resumed_timings = {}
for index = 2, #timings do
  resumed_timings[#resumed_timings + 1] = timings[index]
end
table.sort(resumed_timings)
local resumed_median_ms = resumed_timings[math.floor((#resumed_timings + 1) / 2)]
local resumed_slowest_ms = resumed_timings[#resumed_timings]

io.write(string.format(
  "bilingual_filter session init: first=%.2fms resumed_median=%.2fms resumed_slowest=%.2fms budget=%.2fms iterations=%d\n",
  first_ms,
  resumed_median_ms,
  resumed_slowest_ms,
  budget_ms,
  iterations
))

assert(
  resumed_median_ms <= budget_ms,
  string.format(
    "resumed session init median %.2fms exceeds one-frame budget %.2fms",
    resumed_median_ms,
    budget_ms
  )
)
