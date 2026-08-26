package.path = "./rime/lua/?.lua;" .. package.path

local processor = require("selection_keeper")

local function notifier()
  local connections = {}
  return {
    connect = function(self, callback)
      local connection = {
        active = true,
        disconnect = function(item)
          item.active = false
        end,
      }
      table.insert(connections, { callback = callback, connection = connection })
      return connection
    end,
    emit = function(self, context)
      for _, item in ipairs(connections) do
        if item.connection.active then
          item.callback(context)
        end
      end
    end,
  }
end

local function fixture()
  local select_notifier = notifier()
  local update_notifier = notifier()
  local commit_notifier = notifier()
  local delete_notifier = notifier()
  local candidates = {}
  for index = 0, 9 do
    candidates[index] = { text = "候选" .. tostring(index) }
  end

  local segment = {
    selected_index = 0,
    get_candidate_at = function(_, index)
      return candidates[index]
    end,
  }
  local composition = {
    empty = function()
      return false
    end,
    back = function()
      return segment
    end,
  }
  local context = {
    input = "fayige",
    caret_pos = 7,
    composing = true,
    menu = true,
    composition = composition,
    select_notifier = select_notifier,
    update_notifier = update_notifier,
    commit_notifier = commit_notifier,
    delete_notifier = delete_notifier,
    highlight_calls = 0,
    is_composing = function(self)
      return self.composing
    end,
    has_menu = function(self)
      return self.menu
    end,
    highlight = function(self, index)
      self.highlight_calls = self.highlight_calls + 1
      segment.selected_index = index
      update_notifier:emit(self)
      return true
    end,
  }
  local selector = {
    process_key_event = function(_, key)
      if key:repr() ~= "Down" then return 2 end
      segment.selected_index = math.min(segment.selected_index + 1, 9)
      -- Context::Highlight emits update_notifier, not select_notifier.
      update_notifier:emit(context)
      return 1
    end,
  }
  local env = {
    engine = { context = context },
    selection_selector = selector,
  }
  processor.init(env)
  return {
    env = env,
    context = context,
    segment = segment,
    candidates = candidates,
    select_notifier = select_notifier,
    update_notifier = update_notifier,
    commit_notifier = commit_notifier,
    delete_notifier = delete_notifier,
  }
end

local function key(name)
  return {
    repr = function()
      return name
    end,
  }
end

local function navigate_down(case, count)
  for _ = 1, count do
    assert(processor.func(key("Down"), case.env) == 1, "Down must be accepted")
  end
end

local function select(case, index)
  case.segment.selected_index = index
  case.select_notifier:emit(case.context)
end

local function refresh(case)
  -- Squirrel's option update rebuilds the composition and resets the highlight.
  case.segment.selected_index = 0
  case.update_notifier:emit(case.context)
end

local function test_restores_absolute_index_across_pages()
  local case = fixture()
  navigate_down(case, 6)
  refresh(case)
  assert(
    case.segment.selected_index == 6,
    "AI refresh must restore the same absolute candidate index across pages"
  )
  assert(case.context.highlight_calls == 1, "restoration must highlight exactly once")
  processor.fini(case.env)
end

local function test_keeps_latest_user_selection_across_repeated_refreshes()
  local case = fixture()
  select(case, 3)
  select(case, 7)
  refresh(case)
  assert(case.segment.selected_index == 7, "the latest user selection must win")
  refresh(case)
  assert(case.segment.selected_index == 7, "repeated AI refreshes must preserve selection")
  assert(case.context.highlight_calls == 2, "each reset must be restored exactly once")
  processor.fini(case.env)
end

local function test_does_not_restore_stale_input()
  local case = fixture()
  select(case, 6)
  case.context.input = "fayigeren"
  refresh(case)
  assert(case.segment.selected_index == 0, "changed input must invalidate the snapshot")
  assert(case.context.highlight_calls == 0, "changed input must not be highlighted")
  processor.fini(case.env)
end

local function test_does_not_restore_stale_caret_position()
  local case = fixture()
  select(case, 6)
  case.context.caret_pos = 3
  refresh(case)
  assert(case.segment.selected_index == 0, "changed caret position must invalidate the snapshot")
  processor.fini(case.env)
end

local function test_does_not_restore_a_different_candidate()
  local case = fixture()
  select(case, 6)
  case.candidates[6] = { text = "另一个候选" }
  refresh(case)
  assert(case.segment.selected_index == 0, "candidate identity changes must not restore by index alone")
  assert(case.context.highlight_calls == 0, "a different candidate must never be highlighted")
  processor.fini(case.env)
end

local function test_clears_snapshot_when_composition_closes()
  local case = fixture()
  select(case, 6)
  case.context.composing = false
  refresh(case)
  assert(case.segment.selected_index == 0, "closed compositions must not be reopened")
  processor.fini(case.env)
end

local function test_commit_and_delete_clear_snapshot()
  for _, notifier_name in ipairs({ "commit_notifier", "delete_notifier" }) do
    local case = fixture()
    select(case, 6)
    case[notifier_name]:emit(case.context)
    refresh(case)
    assert(case.segment.selected_index == 0, notifier_name .. " must clear the snapshot")
    processor.fini(case.env)
  end
end

local function test_fini_disconnects_notifiers()
  local case = fixture()
  select(case, 6)
  processor.fini(case.env)
  refresh(case)
  assert(case.segment.selected_index == 0, "fini must disconnect update restoration")
end

test_restores_absolute_index_across_pages()
test_keeps_latest_user_selection_across_repeated_refreshes()
test_does_not_restore_stale_input()
test_does_not_restore_stale_caret_position()
test_does_not_restore_a_different_candidate()
test_clears_snapshot_when_composition_closes()
test_commit_and_delete_clear_snapshot()
test_fini_disconnects_notifiers()

print("selection_keeper_test: ok")
