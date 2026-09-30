extends Node
## Автотесты боевой системы и цикла смерти.
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
	test_roll_iframes()
	test_parry()
	test_stamina_gate()
	test_kill_gives_ash()
	test_death_drops_and_reclaims_ash()
	test_second_death_loses_ash()
	test_gate_fall()
	test_night_progression()
	test_beacon_levelup()
	test_boss_night_smoke()

	print("")
	print("ПРОВАЛОВ: %d" % failures)
	get_tree().quit(1 if failures > 0 else 0)


func check(cond: bool, name: String) -> void:
	if cond:
		print("  ok    ", name)
	else:
		failures += 1
		print("  FAIL  ", name)


func fresh_night(n: int = 1) -> Player:
	game.go_beacon()
	game.start_night(n, true)
	# Далёкий спавн держит ночь открытой, пока тест не закончится.
	game.schedule = [[9999.0, "husk"]]
	return game.player


func press(action: String) -> void:
	game.buf[action] = game.BUFFER_TIME


func run(seconds: float) -> void:
	for i in int(seconds / DT):
		game.step(DT)


# ------------------------------------------------------------------

func test_arc() -> void:
	check(Combat.in_arc(Vector2.ZERO, Vector2.RIGHT, Vector2(10, 0), 20.0, 1.0), "дуга: цель впереди")
	check(not Combat.in_arc(Vector2.ZERO, Vector2.RIGHT, Vector2(-10, 0), 20.0, 1.0), "дуга: цель сзади")
	check(not Combat.in_arc(Vector2.ZERO, Vector2.RIGHT, Vector2(40, 0), 20.0, 1.0), "дуга: цель далеко")


func test_roll_iframes() -> void:
	var p := fresh_night()
	var st := p.stamina
	press("roll")
	run(0.1)
	check(p.state == "roll", "перекат начался")
	check(p.stamina < st, "перекат тратит выносливость")
	check(p.take_hit(30.0, p.position + Vector2(5, 0), true) == "dodged", "неуязвимость в перекате")
	check(p.hp == p.max_hp, "урон в перекате не прошёл")


func test_parry() -> void:
	var p := fresh_night()
	press("parry")
	game.step(DT)
	check(p.take_hit(30.0, p.position + Vector2(5, 0), true) == "parried", "парирование в окне")
	check(p.take_hit(30.0, p.position, false) == "hit", "удар по площади не парируется")
	p = fresh_night()
	press("parry")
	run(0.3)
	check(p.take_hit(30.0, p.position + Vector2(5, 0), true) == "hit", "поздний блок не парирует")


func test_stamina_gate() -> void:
	var p := fresh_night()
	p.stamina = 0.0
	press("attack")
	game.step(DT)
	check(p.state != "attack", "без выносливости нельзя атаковать")


func test_kill_gives_ash() -> void:
	var p := fresh_night()
	Save.data.ash = 0
	p.position = Vector2(240, 150)
	var e: Enemy = game.spawn("husk", Vector2(240, 165))
	var gain := e.ash
	for i in 40:
		press("attack")
		run(0.12)
		if e.state == "dead":
			break
	check(e.state == "dead", "утопленник убит комбо")
	check(int(Save.data.ash) == gain, "за убийство начислен пепел")


func test_death_drops_and_reclaims_ash() -> void:
	var p := fresh_night()
	Save.data.ash = 50
	Save.data.dropped = null
	p.position = Vector2(100, 120)
	p.hp = 1.0
	p.take_hit(10.0, p.position + Vector2(3, 0), true)
	run(2.0)
	check(game.screen == "dead", "смерть → экран гибели")
	check(Save.data.dropped != null and int(Save.data.dropped.amount) == 50, "пепел остался на месте гибели")
	check(int(Save.data.ash) == 0, "с собой пепла нет")
	var drop := Vector2(Save.data.dropped.x, Save.data.dropped.y)
	p = fresh_night()
	p.position = drop
	game.step(DT)
	check(int(Save.data.ash) == 50 and Save.data.dropped == null, "пепел возвращён")


func test_second_death_loses_ash() -> void:
	var p := fresh_night()
	Save.data.ash = 0
	Save.data.dropped = {"x": 300.0, "y": 100.0, "amount": 77}
	p.hp = 1.0
	p.take_hit(10.0, p.position, true)
	run(2.0)
	check(Save.data.dropped == null, "повторная гибель развеяла пепел")
	check(game.fall_note.contains("77"), "игрок узнал о потере")


func test_gate_fall() -> void:
	fresh_night()
	Save.data.dropped = null
	game.gate_hp = 0.0
	run(2.0)
	check(game.screen == "dead" and game.fall_title == "КОРДОН ПАЛ", "падение ворот = поражение")


func test_night_progression() -> void:
	Save.data.beacon_night = 1
	fresh_night(1)
	game.schedule.clear()
	game.step(DT)
	check(game.screen == "dawn" and game.night == 2, "ночь 1 → рассвет, ночь 2")
	game.start_night(3, false)
	game.schedule.clear()
	game.step(DT)
	check(game.screen == "beacon" and int(Save.data.beacon_night) == 4, "ночь 4 — новый маяк")


func test_beacon_levelup() -> void:
	game.go_beacon()
	Save.data.ash = 1000
	var before := int(Save.data.vigor)
	check(game.beacon_buy("vigor"), "покупка уровня")
	check(int(Save.data.vigor) == before + 1 and int(Save.data.ash) < 1000, "живучесть выросла, пепел списан")
	Save.data.towers = 2
	check(not game.beacon_buy("tower"), "больше двух лучников нельзя")
	Save.data.ash = 0
	check(not game.beacon_buy("strength"), "без пепла не прокачаться")


## Грубый бот-игрок: идёт к ближайшему врагу, бьёт, иногда перекатывается и лечится.
func test_boss_night_smoke() -> void:
	Save.reset()
	Save.data.towers = 2
	Save.data.vigor = 10
	Save.data.strength = 10
	game.go_beacon()
	game.start_night(6, true)
	var p: Player = game.player
	var saw_phase2 := false
	var time := 0.0
	while time < 240.0 and game.screen == "night":
		var e = game.nearest_enemy(p.position, 999.0)
		var mv := Vector2.ZERO
		if e:
			var to: Vector2 = e.position - p.position
			if to.length() > 18.0:
				mv = to.normalized()
			elif p.stamina > 30.0:
				press("attack")
			if e.state == "windup" and e.windup_time() - e.state_t < 0.2 and to.length() < 50.0 and p.stamina > 24.0:
				press("roll")
				mv = -to.normalized()
		if p.hp < p.max_hp * 0.4:
			press("heal")
		game.buf.move = mv
		game.step(DT)
		time += DT
		if game.boss and game.boss.phase == 2:
			saw_phase2 = true
	print("        бот: экран=%s, время=%.0f с, HP=%.0f, ворота=%.0f, фаза 2=%s" % [game.screen, time, p.hp, game.gate_hp, saw_phase2])
	check(game.screen in ["victory", "dead", "night"], "ночь с боссом отработала без падений")
