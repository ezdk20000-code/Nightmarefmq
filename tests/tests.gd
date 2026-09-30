extends Node
## Автотесты стратегии: приказы, способности, необратимые потери, цикл поражений.
## Запуск: godot --headless res://tests/tests.tscn  (код выхода 0 — всё зелёное)

const DT := 1.0 / 60.0

var failures := 0
var game


func _ready() -> void:
	Save.path = "user://test_save.json"
	Save.reset()
	game = load("res://scenes/main.tscn").instantiate()
	game.manual = true
	add_child(game)

	test_arc()
	test_new_game_roster()
	test_move_order()
	test_wall_path_goes_through_gate()
	test_moving_hero_does_not_attack()
	test_archer_kills_and_gains_xp()
	test_enemy_targets_field_hero_not_wall()
	test_attacks_cannot_be_dodged()
	test_knight_taunt()
	test_firerain_friendly_fire()
	test_hero_death_is_permanent()
	test_defeat_drops_ash_and_win_reclaims()
	test_second_defeat_loses_ash()
	test_night_progression()
	test_beacon_shop()
	balance_runs()

	print("")
	print("ПРОВАЛОВ: %d" % failures)
	get_tree().quit(1 if failures > 0 else 0)


func check(cond: bool, name: String) -> void:
	if cond:
		print("  ok    ", name)
	else:
		failures += 1
		print("  FAIL  ", name)


## Ночь без спавна (далёкий враг держит её открытой).
func fresh_night(n: int = 1) -> void:
	game.go_beacon()
	game.start_night(n, true)
	game.schedule = [[9999.0, "husk"]]


func run(seconds: float) -> void:
	for i in int(seconds / DT):
		game.step(DT)


func hero_of(cls: String) -> Hero:
	for h in game.heroes:
		if h.data.cls == cls:
			return h
	return null


# ------------------------------------------------------------------

func test_arc() -> void:
	check(Combat.in_arc(Vector2.ZERO, Vector2.RIGHT, Vector2(10, 0), 20.0, 1.0), "дуга: цель впереди")
	check(not Combat.in_arc(Vector2.ZERO, Vector2.RIGHT, Vector2(-10, 0), 20.0, 1.0), "дуга: цель сзади")


func test_new_game_roster() -> void:
	game.new_game()
	check(game.screen == "beacon", "новая игра начинается у маяка")
	check(Save.data.roster.size() == 3, "стартовый гарнизон — 3 героя")
	fresh_night()
	check(game.heroes.size() == 3, "герои вышли на поле")


func test_move_order() -> void:
	game.new_game()
	fresh_night()
	var k := hero_of("knight")
	game.order_move(k, Vector2(100, 120))
	run(6.0)
	check(k.position.distance_to(Vector2(100, 120)) < 1.0, "рыцарь дошёл до точки приказа")


func test_wall_path_goes_through_gate() -> void:
	game.new_game()
	fresh_night()
	var a := hero_of("archer")
	check(a.on_wall(), "лучник стоит на стене")
	a.order_move(Vector2(100, 150))
	check(a.path.size() == 2 and a.path[0] == Combat.GATE_WAY, "со стены в поле — через ворота")


func test_moving_hero_does_not_attack() -> void:
	game.new_game()
	fresh_night()
	var a := hero_of("archer")
	var e: Enemy = game.spawn("husk", a.position + Vector2(0, -40))
	a.order_move(Vector2(400, 226))
	run(0.5)
	check(game.projectiles.all(func(p): return p.get("src") != a), "герой в движении не стреляет")


func test_archer_kills_and_gains_xp() -> void:
	game.new_game()
	fresh_night()
	Save.data.ash = 0
	var a := hero_of("archer")
	var e: Enemy = game.spawn("husk", a.position + Vector2(0, -60))
	var gain := e.ash
	run(15.0)
	check(e.state == "dead", "утопленник убит")
	check(int(Save.data.ash) >= gain, "за убийство начислен пепел")


func test_enemy_targets_field_hero_not_wall() -> void:
	game.new_game()
	fresh_night()
	var a := hero_of("archer")
	var k := hero_of("knight")
	k.position = Vector2(60, 100)
	var e: Enemy = game.spawn("husk", a.position + Vector2(0, -16))
	e.tick(DT, game)
	check(e.target == null, "утопленник не видит героя на стене")
	k.position = e.position + Vector2(0, -20)
	e.tick(DT, game)
	check(e.target == k, "утопленник атакует героя в поле")
	k.position = Vector2(60, 100)
	var s: Enemy = game.spawn("spitter", a.position + Vector2(0, -60))
	s.tick(DT, game)
	check(s.target != null and s.target.on_wall(), "плевальщица достаёт до стены")


func test_attacks_cannot_be_dodged() -> void:
	game.new_game()
	fresh_night()
	var k := hero_of("knight")
	k.position = Vector2(240, 120)
	var e: Enemy = game.spawn("spear", Vector2(240, 90))
	e.cooldown = 0.0
	var hp0 := k.hp
	for i in 30:
		game.step(DT)
		if e.state == "windup":
			break
	game.order_move(k, Vector2(262, 120))
	run(1.2)
	check(k.hp < hp0, "отход во время замаха не спасает от удара")
	var a := hero_of("archer")
	var s: Enemy = game.spawn("spitter", a.position + Vector2(0, -80))
	var hpa := a.hp
	for i in 90:
		game.step(DT)
		if s.state == "active":
			break
	game.order_move(a, a.position + Vector2(60, 0))
	run(2.0)
	check(a.hp < hpa, "плевок летит за целью")


func test_knight_taunt() -> void:
	game.new_game()
	fresh_night()
	var k := hero_of("knight")
	var p := hero_of("priest")
	p.position = Vector2(300, 150)
	k.position = Vector2(330, 150)
	var e: Enemy = game.spawn("husk", Vector2(300, 140))
	check(game.cast_ability(k, k.position), "вызов применён")
	e.tick(DT, game)
	check(e.target == k, "враг после вызова бьёт рыцаря")
	check(not game.cast_ability(k, k.position), "повторно — только после перезарядки")


func test_firerain_friendly_fire() -> void:
	game.new_game()
	Save.data.roster.append(game.make_hero("mage", 0))
	fresh_night()
	var m := hero_of("mage")
	var k := hero_of("knight")
	m.position = Vector2(240, 150)
	k.position = Vector2(240, 110)
	var hp0 := k.hp
	check(game.cast_ability(m, k.position), "огненный дождь применён")
	run(1.2)
	check(k.hp < hp0, "огонь задел своего")


func test_hero_death_is_permanent() -> void:
	game.new_game()
	fresh_night()
	var p := hero_of("priest")
	var name: String = p.data.name
	p.take_damage(9999.0, game)
	check(game.heroes.size() == 2, "павший исчез с поля")
	check(Save.data.roster.size() == 2, "павший удалён из сохранения")
	check(Save.data.fallen.size() == 1 and Save.data.fallen[0].name == name, "павший записан в память")
	Save.load_game()
	check(Save.data.roster.size() == 2, "после перезагрузки его не вернуть")


func test_defeat_drops_ash_and_win_reclaims() -> void:
	game.new_game()
	fresh_night()
	Save.data.ash = 50
	game.gate_hp = 0.0
	run(2.0)
	check(game.screen == "dead", "ворота пали → поражение")
	check(int(Save.data.dropped_ash) == 50 and int(Save.data.ash) == 0, "пепел остался у ворот")
	game.go_beacon()
	game.start_night(1, true)
	game.schedule.clear()
	game.step(DT)
	check(int(Save.data.ash) == 50 and int(Save.data.dropped_ash) == 0, "победа вернула пепел")


func test_second_defeat_loses_ash() -> void:
	game.new_game()
	Save.data.dropped_ash = 77
	fresh_night()
	game.gate_hp = 0.0
	run(2.0)
	check(int(Save.data.dropped_ash) == 0, "второе поражение развеяло пепел")
	check(game.fall_note.contains("77"), "игрок узнал о потере")


func test_night_progression() -> void:
	game.new_game()
	fresh_night(1)
	game.schedule.clear()
	game.step(DT)
	check(game.screen == "dawn" and game.night == 2, "ночь 1 → рассвет, ночь 2")
	game.start_night(3, false)
	game.schedule.clear()
	game.step(DT)
	check(game.screen == "beacon" and int(Save.data.beacon_night) == 4, "ночь 4 — новый маяк")


func test_beacon_shop() -> void:
	game.new_game()
	Save.data.ash = 5000
	check(game.beacon_buy("recruit"), "призыв героя")
	check(Save.data.roster.size() == 4, "в гарнизоне 4 героя")
	var r: Dictionary = Save.data.roster[0]
	check(game.beacon_buy("train:%d" % int(r.id)) and int(r.lvl) == 2, "тренировка повышает уровень")
	Save.data.towers = 2
	check(not game.beacon_buy("tower"), "больше двух лучников на башнях нельзя")
	for i in 5:
		game.beacon_buy("recruit")
	check(Save.data.roster.size() == game.MAX_HEROES, "не больше %d героев" % game.MAX_HEROES)
	Save.data.ash = 0
	check(not game.beacon_buy("gate"), "без пепла ничего не купить")
	Save.data.roster.clear()
	game.go_beacon()
	check(Save.data.roster.size() == 2, "без героев к маяку приходят добровольцы")


# ------------------------------------------------------------------ баланс

## Простой «командир»: только жмёт способности, героев не двигает.
func bot_step() -> void:
	for h in game.heroes:
		if h.ab_cd > 0.0:
			continue
		if h.cls.targeted:
			var e = game.nearest_enemy(h.position, h.attack_range() * 1.4)
			if e and (h.data.cls != "mage" or _no_friends_near(e.position, 42.0)):
				game.cast_ability(h, e.position)
		elif h.data.cls == "priest":
			for x in game.heroes:
				if x.hp < x.max_hp * 0.5:
					game.cast_ability(h, h.position)
					break
		elif game.nearest_enemy(h.position, 40.0):
			game.cast_ability(h, h.position)

func _no_friends_near(p: Vector2, r: float) -> bool:
	for h in game.heroes:
		if h.position.distance_to(p) < r:
			return false
	return true


## Проходит кампанию ботом и печатает, где он спотыкается. Проверяет только отсутствие падений.
func balance_runs() -> void:
	var results: Array = []
	for run_i in 3:
		game.new_game()
		var guard := 0
		while guard < 400000 and int(Save.data.defeats) < 8:
			guard += 1
			if game.screen == "victory":
				break
			match game.screen:
				"beacon":
					var bought := true
					while bought:
						bought = game.beacon_buy("recruit") or game.beacon_buy("tower") or game.beacon_buy("gate")
						if not bought:
							for r in Save.data.roster:
								if game.beacon_buy("train:%d" % int(r.id)):
									bought = true
									break
					if Save.data.roster.is_empty():
						break
					game.start_night(game.night, true)
				"dawn":
					game.start_night(game.night, false)
				"dead":
					game.go_beacon()
				"night":
					bot_step()
					game.step(DT)
		results.append("ночь %d, поражений %d, павших %d, живых %d — %s" % [game.night, int(Save.data.defeats),
			Save.data.fallen.size(), Save.data.roster.size(), "ПОБЕДА" if game.screen == "victory" else "не прошёл"])
	for r in results:
		print("        бот: ", r)
	check(true, "кампания прогнана ботом без падений")
