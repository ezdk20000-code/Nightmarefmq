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
	game.new_game()
	Save.data.roster.append(game.make_hero("mage", 3))
	Save.data.roster.append(game.make_hero("archer", 2))
	Save.data.ash = 140
	Save.data.dropped_ash = 63
	Save.data.fallen.append({"name": "Торин", "cls": "knight", "rarity": 1, "lvl": 3, "night": 2})
	game.go_beacon()
	await _wait(10)
	await _shot("2_beacon")
	Save.data.towers = 1
	game.manual = true
	game.start_night(3, true)
	game.schedule.clear()
	var k: Hero = game.heroes[0]
	k.position = Vector2(240, 150)
	for i in 8:
		game.spawn(["husk", "hound", "spitter", "husk"][i % 4], Vector2(150 + i * 25, 70 + (i % 3) * 20))
	for i in 200:
		game.step(1.0 / 60.0)
		await get_tree().process_frame
	game.targeting = game.heroes[3]
	await _shot("3_night")
	game.targeting = null
	game.start_night(6, true)
	for i in 420:
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
