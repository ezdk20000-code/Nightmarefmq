extends Node2D
## Пепел Кордона — главный оркестратор: экраны, ночи, спавн, бой, HUD.
## Симуляция идёт только через step(), поэтому её можно гонять в тестах без ввода и рендера.

const W := 480
const H := 270
const TOWER_SLOTS := [Vector2(128, 218), Vector2(352, 218)]
const BEACONS := [1, 4]
const LAST_NIGHT := 6
const BUFFER_TIME := 0.2
const NIGHT_PLAN := {
	1: {"husk": 6},
	2: {"husk": 6, "hound": 3},
	3: {"husk": 8, "hound": 4, "spear": 2},
	4: {"husk": 6, "hound": 6, "spear": 4},
	5: {"husk": 10, "hound": 6, "spear": 5},
	6: {"lord": 1, "husk": 4},
}

var screen := "title"
var paused := false
var menu_idx := 0
var night := 1
var night_t := 0.0
var schedule: Array = []
var player: Player
var enemies: Array = []
var boss: Enemy = null
var gate_max := 300.0
var gate_hp := 300.0
var tower_cd := [0.0, 0.0]
var projectiles: Array = []
var particles: Array = []
var floaters: Array = []
var hitstop := 0.0
var shake := 0.0
var fall_timer := -1.0
var fall_title := ""
var fall_note := ""
var banner := ""
var banner_t := 0.0
var t := 0.0
var manual := false
var buf := {"move": Vector2.ZERO, "attack": 0.0, "roll": 0.0, "parry": 0.0, "heal": 0.0}

var world: Node2D
var fx: Node2D
var hud: Node2D
var bg_tex: Texture2D
var font: Font


func _ready() -> void:
	font = ThemeDB.fallback_font
	bg_tex = _make_background()
	world = Node2D.new()
	world.y_sort_enabled = true
	add_child(world)
	fx = Node2D.new()
	fx.z_index = 10
	add_child(fx)
	fx.draw.connect(_draw_fx)
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	hud = Node2D.new()
	layer.add_child(hud)
	hud.draw.connect(_draw_hud)
	player = Player.new()
	world.add_child(player)
	world.visible = false


func _process(delta: float) -> void:
	t += delta
	banner_t = maxf(0.0, banner_t - delta)
	if not manual:
		_read_input(delta)
		_menu_input()
		if screen == "night" and not paused:
			step(minf(delta, 1.0 / 30.0))
	shake = maxf(0.0, shake - delta)
	position = Vector2(randi_range(-2, 2), randi_range(-2, 2)) if shake > 0.0 else Vector2.ZERO
	queue_redraw()
	fx.queue_redraw()
	hud.queue_redraw()


# ------------------------------------------------------------------ симуляция

func step(dt: float) -> void:
	if screen != "night":
		return
	if hitstop > 0.0:
		hitstop -= dt
		return
	night_t += dt
	while not schedule.is_empty() and schedule[0][0] <= night_t:
		var s: Array = schedule.pop_front()
		spawn(s[1], Vector2(randf_range(40, 440), 24))
	player.tick(dt, buf, self)
	for e in enemies.duplicate():
		e.tick(dt, self)
	_separate()
	_update_towers(dt)
	_update_projectiles(dt)
	_check_ash_pickup()
	_update_fx(dt)
	if fall_timer >= 0.0:
		fall_timer -= dt
		if fall_timer < 0.0:
			screen = "dead"
			menu_idx = 0
	elif player.state == "dead":
		_fall("ВЫ ПАЛИ", player.position)
	elif gate_hp <= 0.0:
		_fall("КОРДОН ПАЛ", Combat.GATE_POS + Vector2(0, -12))
	elif schedule.is_empty() and enemies.is_empty():
		_night_won()


func build_schedule(n: int) -> Array:
	var plan: Dictionary = NIGHT_PLAN[n]
	var kinds: Array = []
	for k in plan:
		if k != "lord":
			for i in plan[k]:
				kinds.append(k)
	kinds.shuffle()
	var out: Array = []
	var gap := maxf(1.3, 4.2 - n * 0.45)
	var time := 2.5
	if plan.has("lord"):
		out.append([time, "lord"])
		time += 12.0
	for k in kinds:
		out.append([time, k])
		time += gap * randf_range(0.7, 1.3)
	return out


func spawn(kind: String, pos: Vector2) -> Enemy:
	var e := Enemy.new()
	e.setup(kind, night)
	e.position = pos
	world.add_child(e)
	enemies.append(e)
	if e.is_boss():
		boss = e
		show_banner(e.def.name.to_upper())
	_burst(pos, [Color("3b5dc9"), Color("41a6f6")], 8, 40.0)
	return e


func nearest_enemy(pos: Vector2, max_dist: float) -> Enemy:
	var best: Enemy = null
	var bd := max_dist
	for e in enemies:
		var d: float = pos.distance_to(e.position)
		if d < bd:
			bd = d
			best = e
	return best


func player_strike(p: Player, a: Dictionary) -> void:
	for e in enemies.duplicate():
		var id: int = e.get_instance_id()
		if p.hit_set.has(id):
			continue
		if Combat.in_arc(p.position, p.facing, e.position, a.reach, a.half, e.radius):
			p.hit_set[id] = true
			e.take_damage(a.dmg * p.dmg_mult, a.poise, self, true)
			hitstop = maxf(hitstop, 0.05)
			_burst(e.position + Vector2(0, -5), [Color.WHITE, Color("e43b44")], 5, 50.0)


## Возвращает true, если удар во что-то попал (принц или ворота).
func enemy_strike(e: Enemy, a: Dictionary) -> bool:
	var hit := false
	if player.state != "dead":
		var reach_ok := false
		match a.type:
			"arc":
				reach_ok = Combat.in_arc(e.position, e.atk_dir, player.position, a.reach, deg_to_rad(a.arc) * 0.5, 4.0)
			"aoe":
				reach_ok = player.position.distance_to(e.atk_origin) <= a.radius + 3.0
			"dash":
				reach_ok = player.position.distance_to(e.position) <= e.radius + 7.0
		if reach_ok:
			match player.take_hit(a.dmg, e.position, a.get("parryable", true)):
				"parried":
					e.on_parried(self)
					hitstop = 0.12
					floater(player.position + Vector2(0, -20), "ПАРИРОВАНО", Color("73eff7"))
					_burst(player.position + Vector2(0, -6), [Color("73eff7"), Color.WHITE], 10, 70.0)
					hit = true
				"hit":
					hitstop = 0.07
					shake = maxf(shake, 0.2)
					_burst(player.position + Vector2(0, -6), [Color("e43b44"), Color("b13e53")], 8, 60.0)
					hit = true
	if e.target_gate:
		var o: Vector2 = e.atk_origin if a.type == "aoe" else e.position
		if o.distance_to(Combat.GATE_POS) <= 30.0:
			gate_hp -= a.dmg * 0.5
			shake = maxf(shake, 0.1)
			_burst(Combat.GATE_POS + Vector2(0, -4), [Color("566c86"), Color("8b9bb4")], 5, 40.0)
			hit = true
	return hit


func on_enemy_killed(e: Enemy) -> void:
	enemies.erase(e)
	Save.data.ash = int(Save.data.ash) + e.ash
	floater(e.position + Vector2(0, -22), "+%d" % e.ash, Color("ffcd75"))
	_burst(e.position + Vector2(0, -5), [Color("3d4a4f"), Color("ef7d57"), Color("1a1c2c")], 14 if not e.is_boss() else 50, 60.0)
	if e == boss:
		boss = null
		show_banner("ВЛАДЫКА ПОВЕРЖЕН")
		shake = 0.6


func on_boss_phase(e: Enemy) -> void:
	show_banner("ОЗЕРО ГНЕВАЕТСЯ")
	shake = 0.5
	for dx in [-40.0, 40.0]:
		spawn("husk", e.position + Vector2(dx, -10))


func _separate() -> void:
	for i in enemies.size():
		var a: Enemy = enemies[i]
		for j in range(i + 1, enemies.size()):
			var b: Enemy = enemies[j]
			var d := b.position - a.position
			var min_d := a.radius + b.radius
			var l := d.length()
			if l < min_d and l > 0.001:
				var push := d / l * (min_d - l) * 0.5
				a.position -= push
				b.position += push
		if player.state != "dead" and player.state != "roll":
			var dp := player.position - a.position
			var md := a.radius + 4.0
			var pl := dp.length()
			if pl < md and pl > 0.001:
				player.position += dp / pl * (md - pl)


func _update_towers(dt: float) -> void:
	for i in mini(int(Save.data.towers), TOWER_SLOTS.size()):
		tower_cd[i] -= dt
		if tower_cd[i] > 0.0:
			continue
		var from: Vector2 = TOWER_SLOTS[i] + Vector2(0, -12)
		var target := nearest_enemy(from, 170.0)
		if target:
			projectiles.append({"pos": from, "target": target, "last": target.position, "speed": 220.0, "dmg": 9.0, "done": false})
			tower_cd[i] = 1.5


func _update_projectiles(dt: float) -> void:
	for p in projectiles:
		var tg = p.target
		var alive: bool = is_instance_valid(tg) and tg.state != "dead"
		if alive:
			p.last = tg.position + Vector2(0, -5)
		var to: Vector2 = p.last - p.pos
		var mv: float = p.speed * dt
		if to.length() <= mv:
			p.done = true
			if alive:
				tg.take_damage(p.dmg, 3.0, self, false)
		else:
			p.pos += to.normalized() * mv
	projectiles = projectiles.filter(func(p): return not p.done)


func _check_ash_pickup() -> void:
	var d = Save.data.dropped
	if d == null or player.state == "dead":
		return
	if player.position.distance_to(Vector2(d.x, d.y)) < 10.0:
		Save.data.ash = int(Save.data.ash) + int(d.amount)
		Save.data.dropped = null
		Save.save_game()
		floater(player.position + Vector2(0, -20), "+%d" % int(d.amount), Color("ffcd75"))
		show_banner("ПЕПЕЛ ВОЗВРАЩЁН")


# ------------------------------------------------------------------ цикл ночей и смерти

func new_game() -> void:
	Save.reset()
	Save.data.started = true
	Save.save_game()
	go_beacon()


func go_beacon() -> void:
	screen = "beacon"
	paused = false
	menu_idx = 0
	night = int(Save.data.beacon_night)
	world.visible = false


func start_night(n: int, fresh: bool) -> void:
	night = n
	night_t = 0.0
	screen = "night"
	paused = false
	fall_timer = -1.0
	hitstop = 0.0
	for c in world.get_children():
		if c is Enemy:
			c.queue_free()
	enemies.clear()
	projectiles.clear()
	particles.clear()
	floaters.clear()
	boss = null
	schedule = build_schedule(n)
	if fresh:
		player.reset_for_beacon(Save.data)
		gate_hp = gate_max
	player.position = Vector2(240, 190)
	player.facing = Vector2.UP
	for k in buf:
		buf[k] = Vector2.ZERO if k == "move" else 0.0
	world.visible = true
	show_banner("НОЧЬ %d" % n)


func _fall(title: String, pos: Vector2) -> void:
	fall_timer = 1.6
	fall_title = title
	fall_note = ""
	var d := Save.data
	if d.dropped != null:
		fall_note = "Прежний пепел (%d) развеян навсегда." % int(d.dropped.amount)
	if int(d.ash) > 0:
		d.dropped = {"x": pos.x, "y": pos.y, "amount": int(d.ash)}
	else:
		d.dropped = null
	d.ash = 0
	d.deaths = int(d.deaths) + 1
	Save.save_game()
	shake = 0.4


func _night_won() -> void:
	if night >= LAST_NIGHT:
		screen = "victory"
		menu_idx = 0
		Save.data.completed = true
		Save.save_game()
		return
	night += 1
	gate_hp = minf(gate_max, gate_hp + gate_max * 0.25)
	if night in BEACONS:
		Save.data.beacon_night = night
		Save.save_game()
		go_beacon()
		show_banner("МАЯК ЗАЖЖЁН")
	else:
		screen = "dawn"
		menu_idx = 0
		Save.save_game()


func player_level() -> int:
	return 1 + int(Save.data.vigor) + int(Save.data.endurance) + int(Save.data.strength)


func level_cost() -> int:
	return int(round(18.0 * pow(1.15, player_level() - 1)))


func beacon_options() -> Array:
	var d := Save.data
	var lc := level_cost()
	var towers := int(d.towers)
	var extra := int(d.flasks_extra)
	return [
		{"id": "start", "label": "Встать в дозор — ночь %d" % night, "cost": 0},
		{"id": "vigor", "label": "Живучесть %d  (+12 здоровья)" % int(d.vigor), "cost": lc},
		{"id": "endurance", "label": "Выносливость %d  (+10 стойкости)" % int(d.endurance), "cost": lc},
		{"id": "strength", "label": "Сила %d  (+12%% урона)" % int(d.strength), "cost": lc},
		{"id": "tower", "label": "Лучник на башню  (%d/2)" % towers, "cost": 70 + 50 * towers, "locked": towers >= 2},
		{"id": "flask", "label": "Фляга угля  (%d/5)" % (3 + extra), "cost": 90 + 60 * extra, "locked": extra >= 2},
		{"id": "menu", "label": "Главное меню", "cost": 0},
	]


## Возвращает true, если покупка прошла.
func beacon_buy(id: String) -> bool:
	var opt: Dictionary = {}
	for o in beacon_options():
		if o.id == id:
			opt = o
	if opt.is_empty() or opt.get("locked", false) or int(Save.data.ash) < opt.cost:
		return false
	Save.data.ash = int(Save.data.ash) - opt.cost
	match id:
		"vigor", "endurance", "strength":
			Save.data[id] = int(Save.data[id]) + 1
		"tower":
			Save.data.towers = int(Save.data.towers) + 1
		"flask":
			Save.data.flasks_extra = int(Save.data.flasks_extra) + 1
	Save.save_game()
	return true


# ------------------------------------------------------------------ ввод и меню

func _read_input(dt: float) -> void:
	buf.move = Input.get_vector("move_left", "move_right", "move_up", "move_down")
	for a in ["attack", "roll", "parry", "heal"]:
		if Input.is_action_just_pressed(a):
			buf[a] = BUFFER_TIME
		else:
			buf[a] = maxf(0.0, buf[a] - dt)


func current_options() -> Array:
	match screen:
		"title":
			var o: Array = []
			if Save.data.started and not Save.data.completed:
				o.append({"id": "continue", "label": "Продолжить  (маяк ночи %d)" % int(Save.data.beacon_night)})
			o.append({"id": "new", "label": "Новая игра"})
			o.append({"id": "quit", "label": "Выход"})
			return o
		"beacon":
			return beacon_options()
		"dawn":
			return [{"id": "next", "label": "Выступить — ночь %d" % night}]
		"dead":
			return [{"id": "to_beacon", "label": "Вернуться к маяку"}]
		"victory":
			return [{"id": "restart", "label": "В главное меню"}]
		"night":
			if paused:
				return [
					{"id": "resume", "label": "Продолжить"},
					{"id": "forfeit", "label": "Покинуть поле боя  (засчитается как гибель)"},
				]
	return []


func _menu_input() -> void:
	if screen == "night" and Input.is_action_just_pressed("pause") and fall_timer < 0.0:
		paused = not paused
		menu_idx = 0
	var opts := current_options()
	if opts.is_empty():
		return
	if Input.is_action_just_pressed("move_up"):
		menu_idx = wrapi(menu_idx - 1, 0, opts.size())
	if Input.is_action_just_pressed("move_down"):
		menu_idx = wrapi(menu_idx + 1, 0, opts.size())
	menu_idx = clampi(menu_idx, 0, opts.size() - 1)
	if Input.is_action_just_pressed("confirm"):
		_activate(opts[menu_idx])


func _activate(o: Dictionary) -> void:
	match o.id:
		"continue", "to_beacon":
			go_beacon()
		"new":
			new_game()
		"quit":
			get_tree().quit()
		"start":
			start_night(night, true)
		"menu", "restart":
			screen = "title"
			menu_idx = 0
			world.visible = false
		"next":
			start_night(night, false)
		"resume":
			paused = false
		"forfeit":
			paused = false
			_fall("ВЫ ОТСТУПИЛИ", player.position)
			fall_timer = 0.0
			screen = "dead"
			menu_idx = 0
		_:
			if not beacon_buy(o.id):
				shake = 0.1


func show_banner(s: String) -> void:
	banner = s
	banner_t = 2.2


# ------------------------------------------------------------------ эффекты

func floater(pos: Vector2, text: String, col: Color) -> void:
	floaters.append({"pos": pos, "text": text, "col": col, "life": 0.9})


func _burst(pos: Vector2, cols: Array, n: int, spd: float) -> void:
	for i in n:
		var v := Vector2.from_angle(randf() * TAU) * randf_range(spd * 0.3, spd)
		particles.append({"pos": pos, "vel": v + Vector2(0, -20), "life": randf_range(0.3, 0.7), "col": cols.pick_random()})


func _update_fx(dt: float) -> void:
	for p in particles:
		p.pos += p.vel * dt
		p.vel.y += 90.0 * dt
		p.life -= dt
	particles = particles.filter(func(p): return p.life > 0.0)
	for f in floaters:
		f.pos.y -= 14.0 * dt
		f.life -= dt
	floaters = floaters.filter(func(f): return f.life > 0.0)


# ------------------------------------------------------------------ отрисовка

func _make_background() -> Texture2D:
	var img := Image.create(W, H, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	img.fill(Color("1c2126"))
	var specks := [Color("232a30"), Color("161a1e"), Color("2a3238")]
	for i in 2600:
		img.set_pixel(rng.randi_range(0, W - 1), rng.randi_range(30, H - 1), specks[rng.randi() % 3])
	for x in W:
		var edge := 26 + int(3.0 * sin(x * 0.07))
		for y in edge + 2:
			if y >= edge:
				img.set_pixel(x, y, Color("3d3a33"))
			else:
				img.set_pixel(x, y, Color("1b2d52") if rng.randf() < 0.08 else Color("14213d"))
	for y in range(218, 236):
		for x in W:
			var mortar := (y - 218) % 5 == 0 or (x + (8 if ((y - 218) / 5) % 2 else 0)) % 16 == 0
			img.set_pixel(x, y, Color("2c323b") if mortar else Color("4a5462"))
	for y in range(236, H):
		for x in W:
			img.set_pixel(x, y, Color("121418") if rng.randf() > 0.05 else Color("1a1d22"))
	for y in range(214, 236):
		for x in range(226, 254):
			img.set_pixel(x, y, Color("0d0f12"))
	return ImageTexture.create_from_image(img)


func _draw() -> void:
	if screen == "title" or screen == "beacon":
		return
	draw_texture(bg_tex, Vector2.ZERO)
	for i in 14:
		var k := int(t * 3.0) * 7 + i * 13
		draw_rect(Rect2((k * 37) % W, 4 + (k * 53) % 18, 3, 1), Color("41a6f6", 0.5))
	# ворота
	var gk := clampf(gate_hp / gate_max, 0.0, 1.0)
	draw_rect(Rect2(226, 214, 28, 22), Color("5a3a22"))
	for x in range(228, 254, 4):
		draw_rect(Rect2(x, 214, 1, 22), Color("2b1c10"))
	if gk < 0.66:
		draw_line(Vector2(230, 216), Vector2(238, 226), Color("0d0f12"), 1.0)
	if gk < 0.33:
		draw_line(Vector2(250, 215), Vector2(242, 232), Color("0d0f12"), 1.0)
	# факелы у ворот
	for x in [220.0, 258.0]:
		var fl := sin(t * 13.0 + x) * 0.5 + 0.5
		draw_circle(Vector2(x, 212), 7.0 + fl * 2.0, Color("ef7d57", 0.12))
		draw_rect(Rect2(x - 1, 210 - fl, 2, 3), Color("ffcd75"))
	# башни
	for i in TOWER_SLOTS.size():
		var tp: Vector2 = TOWER_SLOTS[i]
		draw_rect(Rect2(tp.x - 9, tp.y - 6, 18, 12), Color("3a414c"))
		draw_rect(Rect2(tp.x - 9, tp.y - 8, 4, 2), Color("3a414c"))
		draw_rect(Rect2(tp.x + 5, tp.y - 8, 4, 2), Color("3a414c"))
		if i < int(Save.data.towers):
			Sprites.draw(self, Sprites.tex("archer"), tp + Vector2(0, -6))
	# пепел на месте гибели
	var d = Save.data.dropped
	if d != null:
		var c := Vector2(d.x, d.y)
		var pulse := 0.5 + 0.5 * sin(t * 4.0)
		draw_circle(c, 5.0 + pulse * 2.0, Color("ef7d57", 0.25))
		draw_rect(Rect2(c.x - 1, c.y - 1, 2, 2), Color("ffcd75"))
		draw_rect(Rect2(c.x, c.y - 4 - pulse * 3.0, 1, 1), Color("ef7d57"))


func _draw_fx() -> void:
	if screen == "title" or screen == "beacon":
		return
	for p in particles:
		fx.draw_rect(Rect2(p.pos.round(), Vector2.ONE), p.col)
	for p in projectiles:
		var dir: Vector2 = (p.last - p.pos).normalized()
		fx.draw_line(p.pos, p.pos - dir * 5.0, Color("e8e8e8"), 1.0)
	for f in floaters:
		var col: Color = f.col
		col.a = minf(1.0, f.life * 3.0)
		_text(fx, f.text, f.pos - Vector2(40, 0), 8, col, HORIZONTAL_ALIGNMENT_CENTER, 80)


func _text(ci: CanvasItem, s: String, pos: Vector2, size: int = 8, col: Color = Color.WHITE,
		align: HorizontalAlignment = HORIZONTAL_ALIGNMENT_LEFT, width: float = -1.0) -> void:
	ci.draw_string(font, pos + Vector2(1, 1), s, align, width, size, Color(0, 0, 0, col.a))
	ci.draw_string(font, pos, s, align, width, size, col)


func _center(s: String, y: float, size: int, col: Color) -> void:
	_text(hud, s, Vector2(0, y), size, col, HORIZONTAL_ALIGNMENT_CENTER, W)


func _draw_menu(opts: Array, y0: float, show_cost: bool) -> void:
	var ash := int(Save.data.ash)
	for i in opts.size():
		var o: Dictionary = opts[i]
		var sel := i == menu_idx
		var cost: int = o.get("cost", 0)
		var ok: bool = not o.get("locked", false) and ash >= cost
		var col := Color("ffcd75") if sel else (Color("e8e3d6") if ok else Color("6b6478"))
		var label: String = ("> " if sel else "  ") + o.label
		_text(hud, label, Vector2(80, y0 + i * 14), 10, col)
		if show_cost and cost > 0:
			var right: String = "макс." if o.get("locked", false) else "%d пепла" % cost
			_text(hud, right, Vector2(300, y0 + i * 14), 10, col, HORIZONTAL_ALIGNMENT_RIGHT, 100)


func _draw_hud() -> void:
	match screen:
		"title":
			_hud_title()
		"beacon":
			_hud_beacon()
		_:
			_hud_battle()
			match screen:
				"dawn":
					_overlay(0.6)
					_center("РАССВЕТ", 100, 24, Color("ffcd75"))
					_center("Ночь %d пережита. Здоровье и фляги не восстановлены." % (night - 1), 122, 10, Color("e8e3d6"))
					_draw_menu(current_options(), 150, false)
				"dead":
					hud.draw_rect(Rect2(0, 100, W, 60), Color(0, 0, 0, 0.8))
					_center(fall_title, 136, 32, Color("b13e53"))
					if fall_note != "":
						_center(fall_note, 176, 10, Color("9a93ad"))
					var d = Save.data.dropped
					if d != null:
						_center("Твой пепел (%d) остался на поле боя." % int(d.amount), 190, 10, Color("ef7d57"))
					_draw_menu(current_options(), 214, false)
				"victory":
					_overlay(0.75)
					_center("ВЛАДЫКА ОЗЕРА ПАЛ", 100, 24, Color("ffcd75"))
					_center("Конец демо-версии. Смертей: %d" % int(Save.data.deaths), 124, 10, Color("e8e3d6"))
					_draw_menu(current_options(), 160, false)
			if paused:
				_overlay(0.6)
				_center("ПАУЗА", 100, 24, Color("e8e3d6"))
				_draw_menu(current_options(), 130, false)


func _overlay(a: float) -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color(0, 0, 0, a))


func _bar(x: float, y: float, w: float, frac: float, col: Color, h: float = 3.0) -> void:
	hud.draw_rect(Rect2(x - 1, y - 1, w + 2, h + 2), Color("0b0a10"))
	hud.draw_rect(Rect2(x, y, w * clampf(frac, 0.0, 1.0), h), col)


func _hud_battle() -> void:
	var p := player
	_bar(8, 8, p.max_hp * 0.9, p.hp / p.max_hp, Color("b13e53"))
	var st_col := Color("38b764") if p.stamina > 0.0 else Color("566c86")
	_bar(8, 15, p.max_stamina * 0.9, p.stamina / p.max_stamina, st_col, 2.0)
	for i in p.max_flasks:
		hud.draw_rect(Rect2(8 + i * 6, 21, 4, 6), Color("ef7d57") if i < p.flasks else Color("2c2640"))
	_text(hud, "НОЧЬ %d / %d" % [night, LAST_NIGHT], Vector2(W - 108, 14), 8, Color("9a93ad"), HORIZONTAL_ALIGNMENT_RIGHT, 100)
	_text(hud, "ПЕПЕЛ  %d" % int(Save.data.ash), Vector2(W - 108, H - 8), 10, Color("ffcd75"), HORIZONTAL_ALIGNMENT_RIGHT, 100)
	_text(hud, "ВОРОТА", Vector2(0, 250), 8, Color("9a93ad"), HORIZONTAL_ALIGNMENT_CENTER, W)
	_bar(190, 254, 100, gate_hp / gate_max, Color("8b9bb4"), 2.0)
	if boss and is_instance_valid(boss):
		_text(hud, boss.def.name, Vector2(90, 229), 8, Color("e8e3d6"))
		_bar(90, 232, 300, boss.hp / boss.max_hp, Color("b13e53"), 3.0)
	if banner_t > 0.0:
		var a := minf(1.0, banner_t)
		_center(banner, 80, 16, Color(1.0, 0.8, 0.46, a))
	if night == 1 and night_t < 20.0 and screen == "night":
		_text(hud, "WASD движение · J/ЛКМ удар · Пробел перекат · K/ПКМ парирование · R фляга · Esc пауза",
				Vector2(0, 262), 8, Color("6b6478"), HORIZONTAL_ALIGNMENT_CENTER, W)


func _hud_title() -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color("0b0a10"))
	for i in 50:
		var x := fmod(i * 97.0, W)
		var y := H - fmod(t * (12.0 + i % 7) + i * 53.0, H)
		hud.draw_rect(Rect2(x + sin(t + i) * 3.0, y, 1, 1), Color("ef7d57", 0.3 + 0.5 * fmod(i * 0.37, 1.0)))
	_center("ПЕПЕЛ КОРДОНА", 90, 32, Color("ffcd75"))
	_center("Ни одна ночь не прощает ошибок.", 110, 10, Color("9a93ad"))
	_draw_menu(current_options(), 150, false)
	_text(hud, "v0.1 — вертикальный срез", Vector2(6, H - 6), 8, Color("3a3350"))


func _hud_beacon() -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color("0e0c14"))
	var fl := sin(t * 9.0) * 0.5 + 0.5
	hud.draw_circle(Vector2(40, 150), 26.0 + fl * 4.0, Color("ef7d57", 0.10))
	hud.draw_circle(Vector2(40, 150), 12.0 + fl * 2.0, Color("ef7d57", 0.25))
	hud.draw_rect(Rect2(36, 150, 8, 30), Color("3a414c"))
	hud.draw_rect(Rect2(37, 140 - fl * 3.0, 6, 10), Color("ffcd75"))
	var d := Save.data
	_center("МАЯК  ·  НОЧЬ %d" % night, 34, 16, Color("ffcd75"))
	var stats := "Уровень %d   ·   Здоровье %d   ·   Стойкость %d   ·   Урон ×%.2f" % [
		player_level(), 100 + 12 * int(d.vigor), 100 + 10 * int(d.endurance), 1.0 + 0.12 * int(d.strength)]
	_center(stats, 52, 8, Color("9a93ad"))
	_center("Пепел: %d" % int(d.ash), 66, 10, Color("ef7d57"))
	_draw_menu(beacon_options(), 90, true)
	if d.dropped != null:
		_center("На поле боя ждёт твой пепел: %d. Верни его, не погибнув." % int(d.dropped.amount), 212, 8, Color("ef7d57"))
	_center("Смертей: %d" % int(d.deaths), 226, 8, Color("6b6478"))
	_center("W/S — выбор  ·  E/Enter — подтвердить", 258, 8, Color("3a3350"))
