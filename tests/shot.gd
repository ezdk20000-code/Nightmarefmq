extends Node
## Снимает скриншоты экранов игры: xvfb-run godot res://tests/shot.tscn -- <папка>

var game
var out := "user://"


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	Save.path = "user://shot_save.json"
	Save.reset()
	game = load("res://scenes/main.tscn").instantiate()
	add_child(game)
	await _wait(20)
	await _shot("1_title")
	Save.data.started = true
	Save.data.ash = 140
	Save.data.dropped = {"x": 150.0, "y": 120.0, "amount": 63}
	game.go_beacon()
	await _wait(10)
	await _shot("2_beacon")
	Save.data.towers = 2
	game.start_night(3, true)
	game.manual = true
	for i in 7:
		game.spawn(["husk", "hound", "spear"][i % 3], Vector2(120 + i * 35, 90 + (i % 3) * 25))
	for i in 150:
		game.step(1.0 / 60.0)
		await get_tree().process_frame
	game.player.state = "parry"
	await _shot("3_night")
	game.start_night(6, true)
	for i in 400:
		game.step(1.0 / 60.0)
		await get_tree().process_frame
	await _shot("4_boss")
	get_tree().quit()


func _wait(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.resize(img.get_width() * 2, img.get_height() * 2, Image.INTERPOLATE_NEAREST)
	img.save_png(out.path_join(name + ".png"))
