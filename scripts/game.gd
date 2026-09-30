extends Node2D
## Пепел Кордона — стратегия обороны с хардкорной сложностью в духе souls-like.
## Игрок не сражается сам: он командует гарнизоном — расставляет героев и вовремя применяет их способности.
## Симуляция идёт только через step(), поэтому её можно гонять в тестах без ввода и рендера.

const W := 480
const H := 270
const PANEL_Y := 238
const CARD_W := 79
const TOWER_SLOTS := [Vector2(128, 218), Vector2(352, 218)]
const BEACONS := [1, 4]
const LAST_NIGHT := 6
const MAX_HEROES := 6
const ABILITY_RANGE_MULT := 1.5
const NIGHT_PLAN := {
	1: {"husk": 6},
	2: {"husk": 6, "hound": 3},
	3: {"husk": 6, "hound": 4, "spitter": 2},
	4: {"husk": 6, "hound": 4, "spear": 3, "spitter": 2},
	5: {"husk": 8, "hound": 5, "spear": 4, "spitter": 3},
	6: {"lord": 1, "husk": 4, "spitter": 2},
}
const HERO_NAMES := ["Альрик", "Бренна", "Кассиан", "Дара", "Эйвин", "Фрея", "Гаррет", "Хельга", "Ивар", "Йорн",
	"Кира", "Лиан", "Мирра", "Норд", "Ольга", "Рейн", "Сигрид", "Торин", "Ульф", "Вера", "Зоран", "Ярослава"]

var screen := "title"
var paused := false
var menu_idx := 0
var menu_rects: Array = []
var night := 1
var night_t := 0.0
var schedule: Array = []
var heroes: Array = []
var enemies: Array = []
var boss: Enemy = null
var selected: Hero = null
var targeting: Hero = null
var gate_max := 300.0
var gate_hp := 300.0
var tower_cd := [0.0, 0.0]
var projectiles: Array = []
var effects: Array = []
var particles: Array = []
var floaters: Array = []
var shake := 0.0
var fall_timer := -1.0
var fall_note := ""
var banner := ""
var banner_t := 0.0
var t := 0.0
var manual := false

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
	world.visible = false


func _process(delta: float) -> void:
	t += delta
	banner_t = maxf(0.0, banner_t - delta)
	if not manual:
		_keys()
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
	night_t += dt
	while not schedule.is_empty() and schedule[0][0] <= night_t:
		var s: Array = schedule.pop_front()
		spawn(s[1], Vector2(randf_range(40, 440), 24))
	for h in heroes.duplicate():
		h.tick(dt, self)
	for e in enemies.duplicate():
		e.tick(dt, self)
	_separate()
	_update_towers(dt)
	_update_projectiles(dt)
	_update_effects(dt)
	_update_fx(dt)
	if fall_timer >= 0.0:
		fall_timer -= dt
		if fall_timer < 0.0:
			screen = "dead"
			menu_idx = 0
	elif gate_hp <= 0.0:
		_fall()
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
	var time := 3.0
	if plan.has("lord"):
		out.append([time, "lord"])
		time += 12.0
	for k in kinds:
		out.append([time, k])
		time += gap * randf_range(0.7, 1.3)
	return out


## Разведка: что придёт в ночь n. Честность — часть сложности.
func scout(n: int) -> String:
	var parts: Array = []
	var plan: Dictionary = NIGHT_PLAN[n]
	for k in plan:
		parts.append("%s ×%d" % [Enemy.DEFS[k].name, plan[k]])
	return ", ".join(parts)


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


## Цель для героя: враг в радиусе атаки, ближайший к воротам.
func enemy_for_hero(h: Hero) -> Enemy:
	var best: Enemy = null
	var bd := INF
	var rng := h.attack_range()
	for e in enemies:
		if h.position.distance_to(e.position) - e.radius <= rng:
			var g: float = e.position.distance_to(Combat.GATE_POS)
			if g < bd:
				bd = g
				best = e
	return best


func most_wounded_hero(pos: Vector2, rng: float, min_missing: float) -> Hero:
	var best: Hero = null
	var worst := 1.0
	for h in heroes:
		if h.dead or h.max_hp - h.hp < min_missing or pos.distance_to(h.position) > rng:
			continue
		var r: float = h.hp / h.max_hp
		if r < worst:
			worst = r
			best = h
	return best


func nearest_enemy(pos: Vector2, max_dist: float) -> Enemy:
	var best: Enemy = null
	var bd := max_dist
	for e in enemies:
		var d: float = pos.distance_to(e.position)
		if d < bd:
			bd = d
			best = e
	return best


func hero_projectile(h: Hero, e: Enemy, dmg: float, splash: float) -> void:
	var kind := "fire" if splash > 0.0 else ("holy" if h.data.cls == "priest" else "arrow")
	projectiles.append({"pos": h.position + Vector2(0, -7), "target": e, "last": e.position, "speed": 140.0 if splash > 0.0 else 200.0,
		"dmg": dmg, "splash": splash, "src": h, "kind": kind, "hostile": false, "done": false})


## Возвращает true, если удар во что-то попал (герой или ворота).
func enemy_strike(e: Enemy, a: Dictionary) -> bool:
	var hit := false
	match a.type:
		"arc":
			for h in heroes.duplicate():
				if not h.on_wall() and Combat.in_arc(e.position, e.atk_dir, h.position, a.reach, deg_to_rad(a.arc) * 0.5, 4.0):
					h.take_damage(a.dmg, self)
					hit = true
		"aoe":
			for h in heroes.duplicate():
				if h.position.distance_to(e.atk_origin) <= a.radius + 3.0:
					h.take_damage(a.dmg, self)
					hit = true
			_burst(e.atk_origin, [Color("3b5dc9"), Color("41a6f6"), Color.WHITE], 16, 70.0)
			shake = maxf(shake, 0.2)
		"dash":
			for h in heroes.duplicate():
				if not h.on_wall() and h.position.distance_to(e.position) <= e.radius + 7.0:
					h.take_damage(a.dmg, self)
					hit = true
					break
		"shot":
			projectiles.append({"pos": e.position + Vector2(0, -6), "dest": e.atk_origin, "target": e.target, "speed": a.speed,
				"dmg": a.dmg, "hostile": true, "gate": e.target == null, "kind": "spit", "done": false})
			return true
	if e.target == null:
		var o: Vector2 = e.atk_origin if a.type == "aoe" else e.position
		if o.distance_to(Combat.GATE_POS) <= 30.0:
			_hit_gate(a.dmg * 0.5)
			hit = true
	return hit


func _hit_gate(dmg: float) -> void:
	gate_hp -= dmg
	shake = maxf(shake, 0.1)
	_burst(Combat.GATE_POS + Vector2(0, -2), [Color("566c86"), Color("8b9bb4")], 5, 40.0)


func on_enemy_killed(e: Enemy, src) -> void:
	enemies.erase(e)
	Save.data.ash = int(Save.data.ash) + e.ash
	floater(e.position + Vector2(0, -22), "+%d" % e.ash, Color("ffcd75"))
	_burst(e.position + Vector2(0, -5), [Color("3d4a4f"), Color("ef7d57"), Color("1a1c2c")], 14 if not e.is_boss() else 50, 60.0)
	if src is Hero and is_instance_valid(src) and not src.dead:
		src.gain_xp(e.ash, self)
	if e == boss:
		boss = null
		show_banner("ВЛАДЫКА ПОВЕРЖЕН")
		shake = 0.6


func on_boss_phase(e: Enemy) -> void:
	show_banner("ОЗЕРО ГНЕВАЕТСЯ")
	shake = 0.5
	for dx in [-40.0, 40.0]:
		spawn("husk", e.position + Vector2(dx, -10))


## Смерть героя необратима и сразу пишется в сохранение.
func on_hero_died(h: Hero) -> void:
	heroes.erase(h)
	var roster: Array = Save.data.roster
	for i in roster.size():
		if int(roster[i].id) == int(h.data.id):
			roster.remove_at(i)
			break
	Save.data.fallen.append({"name": h.data.name, "cls": h.data.cls, "rarity": int(h.data.rarity),
		"lvl": int(h.data.lvl), "night": night})
	Save.save_game()
	show_banner("ПОТЕРЯ: %s" % str(h.data.name).to_upper())
	_burst(h.position + Vector2(0, -5), [Color("e43b44"), Color("b13e53"), h.rarity_color()], 20, 60.0)
	if selected == h:
		selected = null
	if targeting == h:
		targeting = null
	h.queue_free()


# ------------------------------------------------------------------ приказы

func select(h: Hero) -> void:
	if selected and is_instance_valid(selected):
		selected.selected = false
	selected = h
	targeting = null
	if h:
		h.selected = true


func order_move(h: Hero, p: Vector2) -> void:
	if h == null or h.dead:
		return
	h.order_move(p)
	var dest := Combat.clamp_order(p)
	_burst(dest, [Color("ffcd75")], 4, 20.0)


func use_ability(h: Hero) -> void:
	if h == null or h.dead or h.ab_cd > 0.0:
		return
	if h.cls.targeted:
		targeting = h
	else:
		cast_ability(h, h.position)


## Возвращает true, если способность применена.
func cast_ability(h: Hero, p: Vector2) -> bool:
	if h == null or h.dead or h.ab_cd > 0.0:
		return false
	var m := h.mult()
	match h.cls.ability:
		"taunt":
			h.taunt_t = 4.0
			for e in enemies:
				if e.position.distance_to(h.position) <= 70.0:
					e.taunt(h, 4.0)
			floater(h.position + Vector2(0, -22), "ВЫЗОВ", Color("e43b44"))
		"volley", "firerain":
			if p.distance_to(h.position) > h.attack_range() * ABILITY_RANGE_MULT:
				floater(p, "далеко", Color("9a93ad"))
				return false
			var fire: bool = h.cls.ability == "firerain"
			effects.append({"kind": "fire" if fire else "volley", "pos": p, "t": 1.0 if fire else 0.4, "t0": 1.0 if fire else 0.4,
				"radius": h.cls.ab_radius, "dmg": (60.0 if fire else 20.0) * m, "src": h, "friendly": fire})
		"prayer":
			for x in heroes:
				x.heal(40.0 * m)
				heal_fx(x)
	h.ab_cd = h.cls.ab_cd
	return true


func _update_effects(dt: float) -> void:
	for ef in effects:
		ef.t -= dt
		if ef.t > 0.0:
			continue
		var src = ef.src if is_instance_valid(ef.src) else null
		for e in enemies.duplicate():
			if e.position.distance_to(ef.pos) <= ef.radius + e.radius:
				e.take_damage(ef.dmg, 25.0, self, src)
		if ef.friendly:
			for h in heroes.duplicate():
				if h.position.distance_to(ef.pos) <= ef.radius:
					h.take_damage(ef.dmg * 0.5, self)
		var cols := [Color("ef7d57"), Color("ffcd75"), Color("e43b44")] if ef.kind == "fire" else [Color("e8e8e8"), Color("8b9bb4")]
		_burst(ef.pos, cols, 24, 70.0)
		if ef.kind == "fire":
			shake = maxf(shake, 0.15)
	effects = effects.filter(func(ef): return ef.t > 0.0)


# ------------------------------------------------------------------ физика и снаряды

## Расталкивание тел. Идущие герои проходят сквозь всех, чтобы приказы не застревали.
func _separate() -> void:
	var bodies: Array = []
	bodies.append_array(enemies)
	for h in heroes:
		if not h.is_moving():
			bodies.append(h)
	for i in bodies.size():
		var a: Node2D = bodies[i]
		for j in range(i + 1, bodies.size()):
			var b: Node2D = bodies[j]
			var ra: float = a.radius if a is Enemy else 4.0
			var rb: float = b.radius if b is Enemy else 4.0
			var d := b.position - a.position
			var l := d.length()
			if l < ra + rb and l > 0.001:
				var push := d / l * (ra + rb - l) * 0.5
				a.position -= push
				b.position += push


func _update_towers(dt: float) -> void:
	for i in mini(int(Save.data.towers), TOWER_SLOTS.size()):
		tower_cd[i] -= dt
		if tower_cd[i] > 0.0:
			continue
		var from: Vector2 = TOWER_SLOTS[i] + Vector2(0, -12)
		var target := nearest_enemy(from, 170.0)
		if target:
			projectiles.append({"pos": from, "target": target, "last": target.position, "speed": 220.0, "dmg": 9.0,
				"splash": 0.0, "src": null, "kind": "arrow", "hostile": false, "done": false})
			tower_cd[i] = 1.5


func _update_projectiles(dt: float) -> void:
	for p in projectiles:
		if p.hostile:
			# Плевок летит за целью: увернуться нельзя.
			var ht = p.target
			if ht != null and is_instance_valid(ht) and not ht.dead:
				p.dest = ht.position
			var to: Vector2 = p.dest - p.pos
			var mv: float = p.speed * dt
			if to.length() <= mv:
				p.done = true
				for h in heroes.duplicate():
					if h.position.distance_to(p.dest) <= 9.0:
						h.take_damage(p.dmg, self)
				if p.gate and p.dest.distance_to(Combat.GATE_POS) <= 30.0:
					_hit_gate(p.dmg * 0.5)
				_burst(p.dest, [Color("b55088"), Color("5d275d")], 8, 40.0)
			else:
				p.pos += to.normalized() * mv
			continue
		var tg = p.target
		var alive: bool = is_instance_valid(tg) and tg.state != "dead"
		if alive:
			p.last = tg.position + Vector2(0, -5)
		var to2: Vector2 = p.last - p.pos
		var mv2: float = p.speed * dt
		if to2.length() > mv2:
			p.pos += to2.normalized() * mv2
			continue
		p.done = true
		var src = p.src if is_instance_valid(p.src) else null
		if p.splash > 0.0:
			for e in enemies.duplicate():
				if e.position.distance_to(p.last) <= p.splash + e.radius:
					e.take_damage(p.dmg * (1.0 if e == tg else 0.6), 8.0, self, src)
			_burst(p.last, [Color("ef7d57"), Color("ffcd75")], 8, 40.0)
		elif alive:
			tg.take_damage(p.dmg, 3.0, self, src)
	projectiles = projectiles.filter(func(p): return not p.done)


# ------------------------------------------------------------------ цикл ночей и поражений

func make_hero(cls: String, rarity: int) -> Dictionary:
	var used := {}
	for r in Save.data.roster:
		used[r.name] = true
	for f in Save.data.fallen:
		used[f.name] = true
	var free := HERO_NAMES.filter(func(n): return not used.has(n))
	var id := int(Save.data.next_id)
	Save.data.next_id = id + 1
	return {"id": id, "name": free.pick_random() if not free.is_empty() else "Безымянный %d" % id,
		"cls": cls, "rarity": rarity, "lvl": 1, "xp": 0, "kills": 0, "hp": null}


func roll_rarity() -> int:
	var roll := randf() * 100.0
	for i in Hero.RARITY.size():
		if roll < Hero.RARITY[i].weight:
			return i
		roll -= Hero.RARITY[i].weight
	return 0


func new_game() -> void:
	Save.reset()
	Save.data.started = true
	Save.data.roster = [make_hero("knight", 1), make_hero("archer", 0), make_hero("priest", 0)]
	Save.save_game()
	go_beacon()


## Маяк: все выжившие исцелены, прогресс сохранён.
func go_beacon() -> void:
	screen = "beacon"
	paused = false
	menu_idx = 0
	night = int(Save.data.beacon_night)
	# Сложно, но без тупиков: если гарнизон почти истреблён, к маяку приходят добровольцы.
	while Save.data.roster.size() < 2:
		Save.data.roster.append(make_hero(["knight", "archer"][Save.data.roster.size()], 0))
		show_banner("К МАЯКУ ПРИШЛИ ДОБРОВОЛЬЦЫ")
	for r in Save.data.roster:
		r.hp = null
	Save.save_game()
	_clear_world()
	world.visible = false


func _clear_world() -> void:
	for c in world.get_children():
		c.queue_free()
	heroes.clear()
	enemies.clear()
	projectiles.clear()
	effects.clear()
	particles.clear()
	floaters.clear()
	boss = null
	selected = null
	targeting = null


func _default_pos(d: Dictionary, i: int) -> Vector2:
	if d.cls == "knight":
		return Vector2(210 + 30 * (i % 3), 176)
	return Vector2(150 + 36 * i, 226)


func start_night(n: int, fresh: bool) -> void:
	_clear_world()
	night = n
	night_t = 0.0
	screen = "night"
	paused = false
	fall_timer = -1.0
	schedule = build_schedule(n)
	gate_max = 300.0 + 60.0 * int(Save.data.gate_level)
	if fresh:
		gate_hp = gate_max
	var roster: Array = Save.data.roster
	for i in roster.size():
		var d: Dictionary = roster[i]
		var h := Hero.new()
		h.setup(d)
		h.position = Vector2(d.x, d.y) if d.has("x") else _default_pos(d, i)
		world.add_child(h)
		heroes.append(h)
	if not heroes.is_empty():
		select(heroes[0])
	world.visible = true
	show_banner("НОЧЬ %d" % n)


func _sync_heroes() -> void:
	for h in heroes:
		h.data.hp = h.hp
		h.data.x = h.position.x
		h.data.y = h.position.y


func _fall() -> void:
	fall_timer = 1.6
	fall_note = ""
	var d := Save.data
	if int(d.dropped_ash) > 0:
		fall_note = "Прежний пепел (%d) развеян навсегда." % int(d.dropped_ash)
	d.dropped_ash = int(d.ash)
	d.ash = 0
	d.defeats = int(d.defeats) + 1
	_sync_heroes()
	Save.save_game()
	shake = 0.4


func _night_won() -> void:
	_sync_heroes()
	if int(Save.data.dropped_ash) > 0:
		Save.data.ash = int(Save.data.ash) + int(Save.data.dropped_ash)
		Save.data.dropped_ash = 0
		show_banner("ПЕПЕЛ ВОЗВРАЩЁН")
	if night >= LAST_NIGHT:
		screen = "victory"
		menu_idx = 0
		Save.data.completed = true
		Save.save_game()
		return
	night += 1
	gate_hp = minf(gate_max, gate_hp + gate_max * 0.25)
	for r in Save.data.roster:
		var mx := Hero.max_hp_for(r)
		r.hp = mx if r.hp == null else minf(mx, float(r.hp) + mx * 0.25)
	if night in BEACONS:
		Save.data.beacon_night = night
		go_beacon()
		show_banner("МАЯК ЗАЖЖЁН")
	else:
		screen = "dawn"
		menu_idx = 0
		Save.save_game()
		world.visible = false


func level_cost(d: Dictionary) -> int:
	return 20 * int(d.lvl)


func beacon_options() -> Array:
	var d := Save.data
	var roster: Array = d.roster
	var towers := int(d.towers)
	var g := int(d.gate_level)
	return [
		{"id": "start", "label": "Встать в дозор — ночь %d" % night, "cost": 0, "locked": roster.is_empty()},
		{"id": "recruit", "label": "Призвать героя  (%d/%d)" % [roster.size(), MAX_HEROES], "cost": 50 + 25 * int(d.recruits),
			"locked": roster.size() >= MAX_HEROES},
		{"id": "train_menu", "label": "Тренировать героев…", "cost": 0},
		{"id": "tower", "label": "Лучник на башню  (%d/2)" % towers, "cost": 70 + 50 * towers, "locked": towers >= 2},
		{"id": "gate", "label": "Укрепить ворота  (%d/3)" % g, "cost": 60 + 40 * g, "locked": g >= 3},
		{"id": "menu", "label": "Главное меню", "cost": 0},
	]


func train_options() -> Array:
	var out: Array = []
	for r in Save.data.roster:
		var lvl := int(r.lvl)
		out.append({"id": "train:%d" % int(r.id), "label": "%s — %s, ур. %d" % [r.name, Hero.CLASSES[r.cls].name, lvl],
			"cost": level_cost(r), "locked": lvl >= Hero.MAX_LEVEL, "rarity": int(r.rarity)})
	out.append({"id": "back", "label": "Назад", "cost": 0})
	return out


## Возвращает true, если покупка прошла.
func beacon_buy(id: String) -> bool:
	var opts := train_options() if id.begins_with("train:") else beacon_options()
	var opt: Dictionary = {}
	for o in opts:
		if o.id == id:
			opt = o
	if opt.is_empty() or opt.get("locked", false) or int(Save.data.ash) < opt.cost:
		return false
	Save.data.ash = int(Save.data.ash) - opt.cost
	if id.begins_with("train:"):
		for r in Save.data.roster:
			if "train:%d" % int(r.id) == id:
				r.lvl = int(r.lvl) + 1
				r.xp = 0
	else:
		match id:
			"recruit":
				var cls: String = Hero.CLASSES.keys().pick_random()
				var h := make_hero(cls, roll_rarity())
				Save.data.roster.append(h)
				Save.data.recruits = int(Save.data.recruits) + 1
				show_banner("%s · %s — %s" % [Hero.RARITY[h.rarity].id, h.name, Hero.CLASSES[cls].name])
			"tower":
				Save.data.towers = int(Save.data.towers) + 1
			"gate":
				Save.data.gate_level = int(Save.data.gate_level) + 1
	Save.save_game()
	return true


# ------------------------------------------------------------------ ввод

func _menu_active() -> bool:
	return screen != "night" or paused


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
		"train":
			return train_options()
		"dawn":
			return [{"id": "next", "label": "Выступить — ночь %d" % night}]
		"dead":
			return [{"id": "to_beacon", "label": "Вернуться к маяку"}]
		"victory":
			return [{"id": "menu", "label": "В главное меню"}]
		"night":
			if paused:
				return [
					{"id": "resume", "label": "Продолжить"},
					{"id": "forfeit", "label": "Сдать крепость  (засчитается как поражение)"},
				]
	return []


func _keys() -> void:
	if screen == "night" and fall_timer < 0.0:
		if Input.is_action_just_pressed("pause"):
			if targeting:
				targeting = null
			else:
				paused = not paused
				menu_idx = 0
		if not paused:
			for i in MAX_HEROES:
				if Input.is_action_just_pressed("select_%d" % (i + 1)) and i < heroes.size():
					select(heroes[i])
			if Input.is_action_just_pressed("ability"):
				use_ability(selected)
			return
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


func _unhandled_input(event: InputEvent) -> void:
	if manual:
		return
	var m := hud.get_local_mouse_position()
	if event is InputEventMouseMotion and _menu_active():
		for i in menu_rects.size():
			if menu_rects[i].has_point(m):
				menu_idx = i
		return
	if not (event is InputEventMouseButton and event.pressed):
		return
	if _menu_active():
		if event.button_index == MOUSE_BUTTON_LEFT:
			var opts := current_options()
			for i in mini(menu_rects.size(), opts.size()):
				if menu_rects[i].has_point(m):
					menu_idx = i
					_activate(opts[i])
					return
		return
	if fall_timer >= 0.0:
		return
	var wm := get_local_mouse_position()
	if event.button_index == MOUSE_BUTTON_RIGHT:
		if targeting:
			targeting = null
		elif selected:
			order_move(selected, wm)
	elif event.button_index == MOUSE_BUTTON_LEFT:
		_left_click(m, wm)


func _left_click(m: Vector2, wm: Vector2) -> void:
	if m.y >= PANEL_Y:
		var i := int((m.x - 4.0) / CARD_W)
		if i >= 0 and i < heroes.size():
			if selected == heroes[i]:
				use_ability(selected)
			else:
				select(heroes[i])
		return
	if targeting:
		if cast_ability(targeting, wm):
			targeting = null
		return
	var h := hero_at(wm)
	if h:
		select(h)
	elif selected:
		order_move(selected, wm)


func hero_at(p: Vector2) -> Hero:
	var best: Hero = null
	var bd := 9.0
	for h in heroes:
		var d: float = p.distance_to(h.position + Vector2(0, -5))
		if d < bd:
			bd = d
			best = h
	return best


func _activate(o: Dictionary) -> void:
	match o.id:
		"continue", "to_beacon":
			go_beacon()
		"new":
			new_game()
		"quit":
			get_tree().quit()
		"start":
			if not o.get("locked", false):
				start_night(night, true)
		"menu":
			screen = "title"
			menu_idx = 0
			world.visible = false
		"train_menu":
			screen = "train"
			menu_idx = 0
		"back":
			screen = "beacon"
			menu_idx = 2
		"next":
			start_night(night, false)
		"resume":
			paused = false
		"forfeit":
			paused = false
			_fall()
			fall_timer = -1.0
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


func heal_fx(h: Hero) -> void:
	_burst(h.position + Vector2(0, -6), [Color("7ee081"), Color("e8e8e8")], 5, 25.0)


func slash_fx(pos: Vector2, dir: float) -> void:
	particles.append({"pos": pos + Vector2(0, -5), "vel": Vector2.ZERO, "life": 0.15, "col": Color.WHITE, "slash": dir})


func _burst(pos: Vector2, cols: Array, n: int, spd: float) -> void:
	for i in n:
		var v := Vector2.from_angle(randf() * TAU) * randf_range(spd * 0.3, spd)
		particles.append({"pos": pos, "vel": v + Vector2(0, -20), "life": randf_range(0.3, 0.7), "col": cols.pick_random()})


func _update_fx(dt: float) -> void:
	for p in particles:
		p.pos += p.vel * dt
		if not p.has("slash"):
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
	for y in range(216, 236):
		for x in W:
			var row := (y - 216) / 5
			var mortar := (y - 216) % 5 == 0 or (x + (8 if row % 2 else 0)) % 16 == 0
			img.set_pixel(x, y, Color("2c323b") if mortar else Color("4a5462"))
	for y in range(236, H):
		for x in W:
			img.set_pixel(x, y, Color("121418") if rng.randf() > 0.05 else Color("1a1d22"))
	return ImageTexture.create_from_image(img)


func _draw() -> void:
	if screen != "night" and screen != "dead":
		return
	draw_texture(bg_tex, Vector2.ZERO)
	for i in 14:
		var k := int(t * 3.0) * 7 + i * 13
		draw_rect(Rect2((k * 37) % W, 4 + (k * 53) % 18, 3, 1), Color("41a6f6", 0.5))
	var gk := clampf(gate_hp / gate_max, 0.0, 1.0)
	draw_rect(Rect2(226, 212, 28, 24), Color("5a3a22"))
	for x in range(228, 254, 4):
		draw_rect(Rect2(x, 212, 1, 24), Color("2b1c10"))
	if gk < 0.66:
		draw_line(Vector2(230, 214), Vector2(238, 226), Color("0d0f12"), 1.0)
	if gk < 0.33:
		draw_line(Vector2(250, 213), Vector2(242, 232), Color("0d0f12"), 1.0)
	for x in [220.0, 258.0]:
		var fl := sin(t * 13.0 + x) * 0.5 + 0.5
		draw_circle(Vector2(x, 212), 7.0 + fl * 2.0, Color("ef7d57", 0.12))
		draw_rect(Rect2(x - 1, 210 - fl, 2, 3), Color("ffcd75"))
	for i in TOWER_SLOTS.size():
		var tp: Vector2 = TOWER_SLOTS[i]
		draw_rect(Rect2(tp.x - 9, tp.y - 6, 18, 12), Color("3a414c"))
		draw_rect(Rect2(tp.x - 9, tp.y - 8, 4, 2), Color("3a414c"))
		draw_rect(Rect2(tp.x + 5, tp.y - 8, 4, 2), Color("3a414c"))
		if i < int(Save.data.towers):
			Sprites.draw(self, Sprites.tex("tower_archer"), tp + Vector2(0, -6))


func _draw_fx() -> void:
	if screen != "night" and screen != "dead":
		return
	for ef in effects:
		var k: float = 1.0 - ef.t / ef.t0
		var col := Color("ef7d57") if ef.kind == "fire" else Color("e8e8e8")
		fx.draw_circle(ef.pos, ef.radius * k, Color(col, 0.18))
		fx.draw_arc(ef.pos, ef.radius, 0.0, TAU, 32, Color(col, 0.8), 1.0)
	if selected and is_instance_valid(selected) and not selected.dead:
		fx.draw_arc(selected.position + Vector2(0, -4), selected.attack_range(), 0.0, TAU, 48, Color(1, 1, 1, 0.18), 1.0)
		var prev := selected.position
		for wp in selected.path:
			fx.draw_line(prev, wp, Color("ffcd75", 0.5), 1.0)
			prev = wp
	if targeting and is_instance_valid(targeting):
		var mp := get_local_mouse_position()
		var ok := mp.distance_to(targeting.position) <= targeting.attack_range() * ABILITY_RANGE_MULT
		var col := Color("ffcd75") if ok else Color("6b6478")
		fx.draw_arc(targeting.position + Vector2(0, -4), targeting.attack_range() * ABILITY_RANGE_MULT, 0.0, TAU, 48, Color(col, 0.25), 1.0)
		fx.draw_arc(mp, targeting.cls.ab_radius, 0.0, TAU, 32, col, 1.0)
	for p in particles:
		if p.has("slash"):
			var a := 0.0 if p.slash > 0.0 else PI
			fx.draw_arc(p.pos, 6.0, a - 1.2, a + 1.2, 8, Color(1, 1, 1, p.life / 0.15), 1.0)
		else:
			fx.draw_rect(Rect2(p.pos.round(), Vector2.ONE), p.col)
	for p in projectiles:
		match p.kind:
			"arrow":
				var dir: Vector2 = (p.last - p.pos).normalized()
				fx.draw_line(p.pos, p.pos - dir * 5.0, Color("e8e8e8"), 1.0)
			"fire":
				fx.draw_rect(Rect2(p.pos - Vector2(2, 2), Vector2(4, 4)), Color("ef7d57"))
				fx.draw_rect(Rect2(p.pos - Vector2(1, 1), Vector2(2, 2)), Color("ffcd75"))
			"holy":
				fx.draw_rect(Rect2(p.pos - Vector2(1, 1), Vector2(2, 2)), Color("ffcd75"))
			"spit":
				fx.draw_rect(Rect2(p.pos - Vector2(2, 2), Vector2(3, 3)), Color("b55088"))
	for f in floaters:
		var c: Color = f.col
		c.a = minf(1.0, f.life * 3.0)
		_text(fx, f.text, f.pos - Vector2(40, 0), 8, c, HORIZONTAL_ALIGNMENT_CENTER, 80)


func _text(ci: CanvasItem, s: String, pos: Vector2, size: int = 8, col: Color = Color.WHITE,
		align: HorizontalAlignment = HORIZONTAL_ALIGNMENT_LEFT, width: float = -1.0) -> void:
	ci.draw_string(font, pos + Vector2(1, 1), s, align, width, size, Color(0, 0, 0, col.a))
	ci.draw_string(font, pos, s, align, width, size, col)


func _center(s: String, y: float, size: int, col: Color) -> void:
	_text(hud, s, Vector2(0, y), size, col, HORIZONTAL_ALIGNMENT_CENTER, W)


func _draw_menu(opts: Array, y0: float, show_cost: bool, x0: float = 80.0, width: float = 320.0) -> void:
	var ash := int(Save.data.ash)
	menu_rects.clear()
	for i in opts.size():
		var o: Dictionary = opts[i]
		var y := y0 + i * 14
		menu_rects.append(Rect2(x0 - 4, y - 11, width + 8, 14))
		var sel := i == menu_idx
		var cost: int = o.get("cost", 0)
		var ok: bool = not o.get("locked", false) and ash >= cost
		var col := Color("ffcd75") if sel else (Color("e8e3d6") if ok else Color("6b6478"))
		if sel:
			hud.draw_rect(Rect2(x0 - 4, y - 11, width + 8, 14), Color(1, 0.8, 0.46, 0.08))
		if o.has("rarity"):
			hud.draw_rect(Rect2(x0 + 2, y - 7, 4, 4), Hero.RARITY[o.rarity].color)
		_text(hud, ("> " if sel else "  ") + o.label, Vector2(x0 + (6 if o.has("rarity") else 0), y), 10, col)
		if show_cost and cost > 0:
			var right: String = "макс." if o.get("locked", false) else "%d пепла" % cost
			_text(hud, right, Vector2(x0 + width - 100, y), 10, col, HORIZONTAL_ALIGNMENT_RIGHT, 100)


func _draw_hud() -> void:
	match screen:
		"title":
			_hud_title()
		"beacon", "train":
			_hud_beacon()
		"dawn":
			_hud_dawn()
		_:
			_hud_battle()
			match screen:
				"dead":
					hud.draw_rect(Rect2(0, 96, W, 64), Color(0, 0, 0, 0.8))
					_center("КОРДОН ПАЛ", 134, 32, Color("b13e53"))
					if fall_note != "":
						_center(fall_note, 176, 10, Color("9a93ad"))
					if int(Save.data.dropped_ash) > 0:
						_center("Пепел (%d) остался у павших ворот. Выиграй следующую ночь — и вернёшь его." % int(Save.data.dropped_ash), 190, 8, Color("ef7d57"))
					_draw_menu(current_options(), 212, false, 160, 160)
				"victory":
					_overlay(0.75)
					_center("ВЛАДЫКА ОЗЕРА ПАЛ", 100, 24, Color("ffcd75"))
					_center("Конец демо-версии. Поражений: %d · Павших героев: %d" % [int(Save.data.defeats), Save.data.fallen.size()], 124, 10, Color("e8e3d6"))
					_draw_menu(current_options(), 160, false, 160, 160)
			if paused:
				_overlay(0.6)
				_center("ПАУЗА", 100, 24, Color("e8e3d6"))
				_draw_menu(current_options(), 130, false, 100, 280)


func _overlay(a: float) -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color(0, 0, 0, a))


func _bar(x: float, y: float, w: float, frac: float, col: Color, h: float = 3.0) -> void:
	hud.draw_rect(Rect2(x - 1, y - 1, w + 2, h + 2), Color("0b0a10"))
	hud.draw_rect(Rect2(x, y, w * clampf(frac, 0.0, 1.0), h), col)


func _hud_battle() -> void:
	_text(hud, "ПЕПЕЛ  %d" % int(Save.data.ash), Vector2(6, 12), 10, Color("ffcd75"))
	_text(hud, "ВОРОТА", Vector2(0, 9), 8, Color("9a93ad"), HORIZONTAL_ALIGNMENT_CENTER, W)
	_bar(190, 12, 100, gate_hp / gate_max, Color("8b9bb4"), 2.0)
	_text(hud, "НОЧЬ %d / %d" % [night, LAST_NIGHT], Vector2(W - 106, 12), 8, Color("9a93ad"), HORIZONTAL_ALIGNMENT_RIGHT, 100)
	if boss and is_instance_valid(boss):
		_text(hud, boss.def.name, Vector2(90, 27), 8, Color("e8e3d6"))
		_bar(90, 30, 300, boss.hp / boss.max_hp, Color("b13e53"), 3.0)
	# карточки героев
	hud.draw_rect(Rect2(0, PANEL_Y, W, H - PANEL_Y), Color("0e0c14"))
	for i in heroes.size():
		var h: Hero = heroes[i]
		var x := 4.0 + i * CARD_W
		var sel := h == selected
		hud.draw_rect(Rect2(x, PANEL_Y + 2, CARD_W - 3, 28), Color("1f1b2b"))
		hud.draw_rect(Rect2(x, PANEL_Y + 2, CARD_W - 3, 28), Color("ffcd75") if sel else h.rarity_color(), false, 1.0)
		_text(hud, "%d %s" % [i + 1, h.data.name], Vector2(x + 3, PANEL_Y + 11), 8, Color("e8e3d6"))
		_text(hud, "%s %d" % [Hero.RARITY[int(h.data.rarity)].id, int(h.data.lvl)], Vector2(x + CARD_W - 40, PANEL_Y + 11), 8, h.rarity_color(), HORIZONTAL_ALIGNMENT_RIGHT, 34)
		_bar(x + 3, PANEL_Y + 15, CARD_W - 9, h.hp / h.max_hp, Color("7ee081") if h.hp > h.max_hp * 0.35 else Color("e43b44"), 2.0)
		var ready: bool = h.ab_cd <= 0.0
		var ab_label: String = h.cls.ab_name if ready else "%s %d" % [h.cls.ab_name, ceili(h.ab_cd)]
		_text(hud, ab_label, Vector2(x + 3, PANEL_Y + 27), 8, Color("ffcd75") if ready else Color("6b6478"))
	if targeting:
		_center("Выбери цель: ЛКМ — применить, ПКМ — отмена", PANEL_Y - 4, 8, Color("ffcd75"))
	elif night == 1 and night_t < 25.0 and screen == "night":
		_center("ЛКМ — выбрать героя / отправить · ПКМ — отправить · Q — способность · 1–6 — герой · Esc — пауза", PANEL_Y - 4, 8, Color("9a93ad"))
	if banner_t > 0.0:
		_center(banner, 80, 16, Color(1.0, 0.8, 0.46, minf(1.0, banner_t)))


func _hud_title() -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color("0b0a10"))
	for i in 50:
		var x := fmod(i * 97.0, W)
		var y := H - fmod(t * (12.0 + i % 7) + i * 53.0, H)
		hud.draw_rect(Rect2(x + sin(t + i) * 3.0, y, 1, 1), Color("ef7d57", 0.3 + 0.5 * fmod(i * 0.37, 1.0)))
	_center("ПЕПЕЛ КОРДОНА", 90, 32, Color("ffcd75"))
	_center("Командуй. Теряй. Выстой.", 110, 10, Color("9a93ad"))
	_draw_menu(current_options(), 150, false, 150, 180)
	_text(hud, "v0.2 — вертикальный срез", Vector2(6, H - 6), 8, Color("3a3350"))


func _hud_beacon() -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color("0e0c14"))
	var fl := sin(t * 9.0) * 0.5 + 0.5
	hud.draw_circle(Vector2(30, 150), 22.0 + fl * 4.0, Color("ef7d57", 0.10))
	hud.draw_circle(Vector2(30, 150), 10.0 + fl * 2.0, Color("ef7d57", 0.25))
	hud.draw_rect(Rect2(26, 150, 8, 30), Color("3a414c"))
	hud.draw_rect(Rect2(27, 140 - fl * 3.0, 6, 10), Color("ffcd75"))
	var d := Save.data
	_center("МАЯК  ·  НОЧЬ %d" % night, 24, 16, Color("ffcd75"))
	_center("Пепел: %d" % int(d.ash), 38, 10, Color("ef7d57"))
	if screen == "train":
		_text(hud, "ТРЕНИРОВКА", Vector2(60, 58), 8, Color("9a93ad"))
		_draw_menu(train_options(), 74, true, 60, 360)
	else:
		_draw_menu(beacon_options(), 62, true, 60, 250)
		_text(hud, "ГАРНИЗОН", Vector2(330, 58), 8, Color("9a93ad"))
		var roster: Array = d.roster
		for i in roster.size():
			var r: Dictionary = roster[i]
			var y := 72 + i * 12
			hud.draw_rect(Rect2(330, y - 6, 4, 4), Hero.RARITY[int(r.rarity)].color)
			_text(hud, "%s · %s %d" % [r.name, Hero.CLASSES[r.cls].name, int(r.lvl)], Vector2(338, y), 8, Color("e8e3d6"))
		var fallen: Array = d.fallen
		if not fallen.is_empty():
			_text(hud, "ПАВШИЕ", Vector2(330, 158), 8, Color("6b6478"))
			for i in mini(fallen.size(), 4):
				var f: Dictionary = fallen[fallen.size() - 1 - i]
				_text(hud, "† %s, ночь %d" % [f.name, int(f.night)], Vector2(330, 170 + i * 10), 8, Color("6b6478"))
	_center("Разведка, ночь %d: %s" % [night, scout(night)], 216, 8, Color("9a93ad"))
	if int(d.dropped_ash) > 0:
		_center("У павших ворот лежит %d пепла. Выиграй следующую ночь — и вернёшь его." % int(d.dropped_ash), 230, 8, Color("ef7d57"))
	_center("Мышь или W/S + E  ·  Поражений: %d" % int(d.defeats), 258, 8, Color("3a3350"))


func _hud_dawn() -> void:
	hud.draw_rect(Rect2(0, 0, W, H), Color("141019"))
	_center("РАССВЕТ", 70, 24, Color("ffcd75"))
	_center("Ночь %d пережита. Раны затянулись лишь на четверть, ворота — тоже." % (night - 1), 94, 8, Color("e8e3d6"))
	_center("Разведка, ночь %d: %s" % [night, scout(night)], 110, 8, Color("9a93ad"))
	var roster: Array = Save.data.roster
	for i in roster.size():
		var r: Dictionary = roster[i]
		var mx := Hero.max_hp_for(r)
		var hpv: float = mx if r.hp == null else float(r.hp)
		var x := 60.0 + (i % 3) * 124.0
		var y := 130.0 + (i / 3) * 20.0
		_text(hud, "%s · %s" % [r.name, Hero.CLASSES[r.cls].name], Vector2(x, y), 8, Hero.RARITY[int(r.rarity)].color)
		_bar(x, y + 3, 100, hpv / mx, Color("7ee081") if hpv > mx * 0.35 else Color("e43b44"), 2.0)
	_draw_menu(current_options(), 200, false, 160, 160)
