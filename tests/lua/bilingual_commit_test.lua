package.path = "./rime/lua/?.lua;" .. package.path

local processor = require("bilingual_commit_processor")

local function key(repr, released)
  return {
    repr = function() return repr end,
    release = function() return released or false end,
  }
end

local function case(candidate, bilingual_output)
  local committed = {}
  local context = {
    cleared = 0,
    is_composing = function() return true end,
    has_menu = function() return true end,
    get_option = function(_, name)
      return name == "bilingual_output" and bilingual_output
    end,
    get_selected_candidate = function() return candidate end,
    clear = function(self) self.cleared = self.cleared + 1 end,
  }
  local engine = {
    context = context,
    commit_text = function(_, value) committed[#committed + 1] = value end,
  }
  return { env = { engine = engine }, context = context, committed = committed }
end

local active = case({ text = "查单词", comment = "look up a word; consult a dictionary" }, true)
assert(processor.func(key("Shift+space"), active.env) == 1)
assert(
  active.committed[1] == "查单词 look up a word; consult a dictionary",
  "Shift+space must preserve the complete visible Chinese and English text"
)
assert(active.context.cleared == 1, "a successful bilingual commit must clear the composition")

local ordinary_space = case({ text = "查单词", comment = "look up a word" }, true)
assert(processor.func(key("space"), ordinary_space.env) == 2)
assert(#ordinary_space.committed == 0, "ordinary space must keep its original Chinese-only behavior")

local hidden = case({ text = "查单词", comment = "look up a word" }, false)
assert(processor.func(key("Shift+space"), hidden.env) == 2)
assert(#hidden.committed == 0, "the shortcut must not commit hidden comments in Chinese-only mode")

local no_comment = case({ text = "未翻译", comment = "" }, true)
assert(processor.func(key("Shift+space"), no_comment.env) == 1)
assert(#no_comment.committed == 0, "candidates without a visible comment must not be committed")
assert(no_comment.context.cleared == 0, "missing comments must leave the composition open")

local released = case({ text = "查单词", comment = "look up a word" }, true)
assert(processor.func(key("Shift+space", true), released.env) == 2)
assert(#released.committed == 0, "key release events must not commit twice")

print("bilingual_commit_test: ok")
