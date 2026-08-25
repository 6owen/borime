package.path = "./rime/lua/?.lua;" .. package.path

local translator = require("mixed_input_translator")
assert(translator._english_display("app", "app") == "APP")
assert(translator._english_display("file", "file") == "file")
assert(translator._english_display("api", "API") == "API")

local spacing = require("mixed_spacing_filter")
assert(spacing._space_internal("打开APP") == "打开 APP")
assert(spacing._space_internal("APP设置") == "APP 设置")
assert(spacing._space_internal("打开 APP") == "打开 APP")
assert(spacing._space_internal("中文，English") == "中文，English")
assert(spacing._add_commit_boundary("APP", "打开") == " APP")
assert(spacing._add_commit_boundary("设置", "APP") == " 设置")
assert(spacing._add_commit_boundary("继续", "打开") == "继续")

print("mixed_input_test: ok")
