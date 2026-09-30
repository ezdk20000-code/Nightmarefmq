extends Node
## Раскладка: мышь (приказы) + клавиатура (горячие клавиши) + геймпад в меню.
## Команды мышью обрабатывает game.gd; здесь — действия для клавиатуры и геймпада.


func _ready() -> void:
	_add("move_up", [KEY_W, KEY_UP], [], [JOY_BUTTON_DPAD_UP], JOY_AXIS_LEFT_Y, -1.0)
	_add("move_down", [KEY_S, KEY_DOWN], [], [JOY_BUTTON_DPAD_DOWN], JOY_AXIS_LEFT_Y, 1.0)
	_add("ability", [KEY_Q, KEY_F], [], [JOY_BUTTON_X])
	for i in 6:
		_add("select_%d" % (i + 1), [KEY_1 + i], [], [])
	_add("confirm", [KEY_E, KEY_ENTER, KEY_KP_ENTER], [], [JOY_BUTTON_A])
	_add("pause", [KEY_ESCAPE], [], [JOY_BUTTON_START])
	_add("fullscreen", [KEY_F11], [], [])


func _add(action: StringName, keys: Array, mouse: Array, pads: Array, axis: int = -1, dir: float = 0.0) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action, 0.35)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		InputMap.action_add_event(action, ev)
	for m in mouse:
		var ev := InputEventMouseButton.new()
		ev.button_index = m
		InputMap.action_add_event(action, ev)
	for b in pads:
		var ev := InputEventJoypadButton.new()
		ev.button_index = b
		InputMap.action_add_event(action, ev)
	if axis >= 0:
		var ev := InputEventJoypadMotion.new()
		ev.axis = axis
		ev.axis_value = dir
		InputMap.action_add_event(action, ev)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("fullscreen"):
		var fs := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fs else DisplayServer.WINDOW_MODE_FULLSCREEN)
