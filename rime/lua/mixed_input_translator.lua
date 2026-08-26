-- Compose an exact Xiaohe double-pinyin prefix with an exact English suffix.
-- Example: dakdapp -> 打开 APP (dakd = 打开, app = APP).

local translator = {}
local candidate_comment = ""

local abbreviations = {
  ai = true, api = true, app = true, cpu = true, css = true, gpu = true,
  html = true, http = true, https = true, ide = true, ios = true,
  ip = true, json = true, llm = true, mac = true, pc = true, pdf = true,
  ram = true, sdk = true, sql = true, ssh = true, tcp = true, ui = true,
  url = true, usb = true, ux = true, vm = true, vpn = true, xml = true,
}

local function english_display(value, input)
  if input:match("^%u+$") then return value:upper() end
  local lower = value:lower()
  if abbreviations[lower] then return lower:upper() end
  return value
end

local function exact_english(mem, code)
  if not mem:dict_lookup(code, false, 20) then return nil end
  local lower_code = code:lower()
  for entry in mem:iter_dict() do
    if entry.text and entry.text:lower() == lower_code then
      return english_display(entry.text, code)
    end
  end
  return nil
end

local function exact_chinese(mem, code, limit)
  local results = {}
  if not mem:dict_lookup(code, false, limit) then return results end
  local seen = {}
  for entry in mem:iter_dict() do
    if entry.text and not seen[entry.text] then
      seen[entry.text] = true
      results[#results + 1] = entry.text
      if #results >= limit then break end
    end
  end
  return results
end

function translator.init(env)
  env.chinese_memory = Memory(env.engine, env.engine.schema)
  env.english_memory = Memory(env.engine, Schema("melt_eng"))
  env.max_candidates = env.engine.schema.config:get_int(
    "mixed_input/max_candidates"
  ) or 3
end

function translator.fini(env)
  if env.chinese_memory and env.chinese_memory.disconnect then
    env.chinese_memory:disconnect()
  end
  if env.english_memory and env.english_memory.disconnect then
    env.english_memory:disconnect()
  end
end

function translator.func(input, segment, env)
  if not env.engine.context:get_option("mixed_input") then return end
  if #input < 4 or not input:match("^[%a%d%+%.#_-]+$") then return end

  -- Prefer the longest valid Chinese prefix. Requiring exact dictionary hits on
  -- both sides prevents ordinary double-pinyin input from being split freely.
  for split = #input - 2, 2, -1 do
    if split % 2 == 0 then
      local chinese_code = input:sub(1, split)
      local english_code = input:sub(split + 1)
      if english_code:match("^%a[%a%d%+%.#_-]+$") then
        local english = exact_english(env.english_memory, english_code)
        if english then
          local chinese = exact_chinese(
            env.chinese_memory,
            chinese_code,
            env.max_candidates
          )
          if #chinese > 0 then
            for _, text in ipairs(chinese) do
              local candidate = Candidate(
                "mixed_input",
                segment.start,
                segment._end,
                text .. " " .. english,
                candidate_comment
              )
              candidate.quality = 1.15
              yield(candidate)
            end
            return
          end
        end
      end
    end
  end
end

translator._english_display = english_display
translator._candidate_comment = candidate_comment

return translator
