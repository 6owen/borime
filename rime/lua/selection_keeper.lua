local processor = {}

local navigation_keys = {
  Up = true,
  Down = true,
  Left = true,
  Right = true,
  Page_Up = true,
  Page_Down = true,
  Home = true,
  End = true,
  KP_Up = true,
  KP_Down = true,
  KP_Left = true,
  KP_Right = true,
  KP_Page_Up = true,
  KP_Page_Down = true,
  KP_Home = true,
  KP_End = true,
}

local function clear_snapshot(env)
  env.selection_snapshot = nil
end

local function active_segment(context)
  if not context:is_composing() or not context:has_menu() then
    return nil
  end
  local composition = context.composition
  if not composition or composition:empty() then
    return nil
  end
  return composition:back()
end

local function candidate_text(segment, index)
  if not segment or type(index) ~= "number" or index < 0 then
    return nil
  end
  local candidate = segment:get_candidate_at(index)
  if not candidate then
    return nil
  end
  return candidate.text
end

local function save_selection(context, env)
  if env.restoring then
    return
  end

  local segment = active_segment(context)
  if not segment then
    clear_snapshot(env)
    return
  end

  local index = segment.selected_index
  local text = candidate_text(segment, index)
  if not text then
    clear_snapshot(env)
    return
  end

  env.selection_snapshot = {
    input = context.input,
    caret_pos = context.caret_pos,
    selected_index = index,
    candidate_text = text,
  }
end

local function restore_selection(context, env)
  local snapshot = env.selection_snapshot
  if not snapshot or env.restoring or env.navigating then
    return
  end

  local segment = active_segment(context)
  if not segment then
    clear_snapshot(env)
    return
  end
  if context.input ~= snapshot.input or context.caret_pos ~= snapshot.caret_pos then
    clear_snapshot(env)
    return
  end
  if candidate_text(segment, snapshot.selected_index) ~= snapshot.candidate_text then
    clear_snapshot(env)
    return
  end
  if segment.selected_index == snapshot.selected_index then
    return
  end

  env.restoring = true
  local succeeded, highlighted = pcall(
    context.highlight,
    context,
    snapshot.selected_index
  )
  env.restoring = false
  if not succeeded or not highlighted then
    clear_snapshot(env)
  end
end

local function connect(notifier, callback)
  if not notifier then
    return nil
  end
  return notifier:connect(callback)
end

function processor.init(env)
  local context = env.engine.context
  if not env.selection_selector and Component and Component.Processor then
    -- Delegate navigation to librime's real selector so layout, paging, and
    -- boundary behavior stay identical to the schema's native selector.
    env.selection_selector = Component.Processor(env.engine, "", "selector")
  end
  env.restoring = false
  env.navigating = false
  env.selection_snapshot = nil
  env.selection_connections = {
    connect(context.select_notifier, function(ctx)
      save_selection(ctx, env)
    end),
    connect(context.update_notifier, function(ctx)
      -- The engine subscribes before Lua components are initialized, so this
      -- ungrouped callback observes the rebuilt composition.
      restore_selection(ctx, env)
    end),
    connect(context.commit_notifier, function()
      clear_snapshot(env)
    end),
    connect(context.delete_notifier, function()
      clear_snapshot(env)
    end),
  }
end

function processor.func(key, env)
  if not navigation_keys[key:repr()] or not env.selection_selector then
    return 2 -- kNoop
  end

  local context = env.engine.context
  if not active_segment(context) then
    return 2
  end

  local event = key
  if KeyEvent then
    event = KeyEvent(key:repr())
  end

  -- Context::Highlight emits update_notifier synchronously. Ignore that
  -- navigation update, then snapshot the index produced by the native selector.
  env.navigating = true
  local succeeded, result = pcall(
    env.selection_selector.process_key_event,
    env.selection_selector,
    event
  )
  env.navigating = false
  if not succeeded then
    return 2
  end
  if result == 1 then -- kAccepted
    save_selection(context, env)
  end
  return result
end

function processor.fini(env)
  for _, connection in ipairs(env.selection_connections or {}) do
    if connection then
      connection:disconnect()
    end
  end
  env.selection_connections = nil
  env.selection_selector = nil
  env.selection_snapshot = nil
  env.restoring = false
  env.navigating = false
end

return processor
