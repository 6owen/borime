-- Commit the highlighted candidate text and its visible bilingual comment.
-- The comment is intentionally kept verbatim: Shift+space means "type exactly
-- what the candidate window shows", without parsing or re-translating it.

local processor = {}

local function combined_text(candidate)
  if not candidate then return nil end
  local text = candidate.text or ""
  local comment = candidate.comment or ""
  if text == "" or comment == "" then return nil end
  return text .. " " .. comment
end

function processor.func(key, env)
  if key:release() or key:repr() ~= "Shift+space" then
    return 2 -- kNoop
  end

  local context = env.engine.context
  if not context:is_composing()
    or not context:has_menu()
    or not context:get_option("bilingual_output") then
    return 2
  end

  local text = combined_text(context:get_selected_candidate())
  -- Keep the composition open when the bilingual comment has not appeared yet;
  -- do not let Shift+space fall through and accidentally confirm something else.
  if not text then return 1 end

  env.engine:commit_text(text)
  context:clear()
  return 1 -- kAccepted
end

processor._combined_text = combined_text

return processor
