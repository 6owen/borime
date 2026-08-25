local processor = {}

local navigation_keys = {
  Up = true,
  Down = true,
  Page_Up = true,
  Page_Down = true,
}

function processor.init(env)
  env.selection_moved = false
end

function processor.func(key, env)
  local context = env.engine.context
  if not context:is_composing() then
    env.selection_moved = false
    return 2 -- kNoop
  end

  local key_name = key:repr()
  if context:has_menu() and navigation_keys[key_name] then
    env.selection_moved = true
    return 2 -- Let Rime's navigator move the highlight.
  end

  if context:has_menu()
    and env.selection_moved
    and (key_name == "Return" or key_name == "KP_Enter") then
    if context:confirm_current_selection() then
      context:commit()
      env.selection_moved = false
      return 1 -- kAccepted
    end
  end

  return 2 -- Keep the schema's normal raw-input Return behavior.
end

return processor
