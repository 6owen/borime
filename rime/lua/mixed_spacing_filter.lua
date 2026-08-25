-- Add typographic spaces at CJK <-> ASCII word boundaries.
-- It handles both a single mixed candidate and consecutive Rime commits.

local filter = {}

local function codepoint(character)
  local a, b, c, d = character:byte(1, 4)
  if not a then return nil end
  if a < 0x80 then return a end
  if a < 0xE0 then return (a - 0xC0) * 0x40 + b - 0x80 end
  if a < 0xF0 then
    return (a - 0xE0) * 0x1000 + (b - 0x80) * 0x40 + c - 0x80
  end
  return (a - 0xF0) * 0x40000 + (b - 0x80) * 0x1000
    + (c - 0x80) * 0x40 + d - 0x80
end

local function characters(value)
  local result = {}
  for character in value:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    result[#result + 1] = character
  end
  return result
end

local function is_cjk(character)
  local value = codepoint(character)
  return value and (
    (value >= 0x3400 and value <= 0x9FFF)
    or (value >= 0xF900 and value <= 0xFAFF)
    or (value >= 0x3040 and value <= 0x30FF)
    or (value >= 0xAC00 and value <= 0xD7AF)
  )
end

local function is_ascii_word(character)
  return character and character:match("^[%a%d]$") ~= nil
end

local function space_internal(value)
  local source = characters(value)
  local result = {}
  for index, character in ipairs(source) do
    local previous = source[index - 1]
    if previous and (
      (is_cjk(previous) and is_ascii_word(character))
      or (is_ascii_word(previous) and is_cjk(character))
    ) then
      result[#result + 1] = " "
    end
    result[#result + 1] = character
  end
  return table.concat(result):gsub(" +", " ")
end

local function add_commit_boundary(value, latest)
  local current = characters(value)
  local history = characters(latest or "")
  local first = current[1]
  local previous = history[#history]
  if first and previous and (
    (is_cjk(previous) and is_ascii_word(first))
    or (is_ascii_word(previous) and is_cjk(first))
  ) then
    return " " .. value
  end
  return value
end

function filter.func(input, env)
  if not env.engine.context:get_option("auto_spacing") then
    for candidate in input:iter() do yield(candidate) end
    return
  end

  local latest = env.engine.context.commit_history:latest_text() or ""
  for candidate in input:iter() do
    local text = add_commit_boundary(space_internal(candidate.text), latest)
    if text ~= candidate.text then
      yield(candidate:to_shadow_candidate("mixed_spacing", text, candidate.comment))
    else
      yield(candidate)
    end
  end
end

filter._space_internal = space_internal
filter._add_commit_boundary = add_commit_boundary

return filter
