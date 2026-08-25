-- Insert one leading space when direct ASCII mode starts after a CJK commit.
-- The processor runs before ascii_composer so the original letter still flows
-- through after the space is committed.

local processor = {}

local function ends_with_cjk(value)
  if not value or value == "" then return false end
  local last
  for character in value:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    last = character
  end
  if not last then return false end
  local a, b, c = last:byte(1, 3)
  if not a or a < 0xE0 or not b or not c then return false end
  local codepoint = (a - 0xE0) * 0x1000 + (b - 0x80) * 0x40 + c - 0x80
  return (codepoint >= 0x3400 and codepoint <= 0x9FFF)
    or (codepoint >= 0xF900 and codepoint <= 0xFAFF)
end

function processor.init(env)
  env.spaced_this_ascii_run = false
end

function processor.func(key, env)
  local context = env.engine.context
  if not context:get_option("ascii_mode") then
    env.spaced_this_ascii_run = false
    return 2
  end
  if not context:get_option("auto_spacing")
    or env.spaced_this_ascii_run
    or context:is_composing() then
    return 2
  end

  local key_name = key:repr()
  if key_name:match("^[%a%d]$") then
    env.spaced_this_ascii_run = true
    local latest = context.commit_history:latest_text() or ""
    if ends_with_cjk(latest) then env.engine:commit_text(" ") end
  end
  return 2
end

processor._ends_with_cjk = ends_with_cjk

return processor
