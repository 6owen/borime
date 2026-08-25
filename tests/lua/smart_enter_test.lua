package.path = "./rime/lua/?.lua;" .. package.path

local processor = require("smart_enter")

local function key(name)
  return { repr = function() return name end }
end

local context = {
  composing = true,
  menu = true,
  confirmed = 0,
  committed = 0,
  is_composing = function(self) return self.composing end,
  has_menu = function(self) return self.menu end,
  confirm_current_selection = function(self)
    self.confirmed = self.confirmed + 1
    return true
  end,
  commit = function(self)
    self.committed = self.committed + 1
    return true
  end,
}

local env = { engine = { context = context } }
processor.init(env)

assert(processor.func(key("Return"), env) == 2, "untouched Return must fall through")
assert(context.confirmed == 0 and context.committed == 0, "untouched Return must keep raw-input behavior")

assert(processor.func(key("Down"), env) == 2, "navigation must fall through")
assert(processor.func(key("Return"), env) == 1, "Return after navigation must be accepted")
assert(context.confirmed == 1 and context.committed == 1, "selected candidate must be confirmed and committed")

context.composing = false
assert(processor.func(key("a"), env) == 2, "non-composing input must fall through")
context.composing = true
assert(processor.func(key("Return"), env) == 2, "a new composition must reset navigation state")

print("smart_enter_test: ok")
