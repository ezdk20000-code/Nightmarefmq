class_name Enemy
extends Node2D
## Враг. Каждая атака честно телеграфируется: контур удара на земле во время замаха
## и красная вспышка за мгновение до удара. Цель — принц (если близко) или ворота.

const GLINT_TIME := 0.12

static var DEFS := {
	"husk": {
		"name": "Утопленник", "sprite": "husk", "hp": 60.0, "speed": 26.0, "poise": 30.0,
		"aggro": 70.0, "stop": 14.0, "radius": 5.0, "ash": 5,
		"attacks": [
			{"type": "arc", "range": 18.0, "reach": 22.0, "arc": 70.0, "windup": 0.7, "active": 0.12, "recover": 0.8, "dmg": 22.0},
		],
	},
	"hound": {
		"name": "Гончая", "sprite": "hound", "hp": 35.0, "speed": 58.0, "poise": 18.0,
		"aggro": 110.0, "stop": 30.0, "radius": 5.0, "ash": 6,
		"attacks": [
			{"type": "dash", "range": 55.0, "windup": 0.45, "active": 0.28, "recover": 0.9, "dmg": 16.0, "dash": 190.0},
		],
	},
	"spear": {
		"name": "Копейщик", "sprite": "spear", "hp": 85.0, "speed": 22.0, "poise": 45.0,
		"aggro": 80.0, "stop": 28.0, "radius": 5.0, "ash": 10,
		"attacks": [
			{"type": "arc", "range": 34.0, "reach": 42.0, "arc": 22.0, "windup": 0.9, "active": 0.12, "recover": 1.0, "dmg": 30.0},
		],
	},
	"lord": {
		"name": "Владыка Озера", "sprite": "lord", "scale": 2.0, "boss": true, "hp": 900.0, "speed": 30.0,
		"poise": 220.0, "aggro": 9999.0, "stop": 26.0, "radius": 11.0, "ash": 300,
		"attacks": [
			{"type": "arc", "range": 34.0, "reach": 46.0, "arc": 110.0, "windup": 0.85, "active": 0.15, "recover": 0.9, "dmg": 35.0},
			{"type": "aoe", "range": 95.0, "windup": 1.1, "active": 0.1, "recover": 1.1, "dmg": 45.0, "radius": 32.0, "parryable": false},
			{"type": "dash", "range": 140.0, "windup": 0.75, "active": 0.55, "recover": 1.3, "dmg": 40.0, "dash": 230.0, "parryable": false, "phase": 2},
		],
	},
}

var kind := ""
var def: Dictionary = {}
var hp := 1.0
var max_hp := 1.0
var radius := 5.0
var ash := 0
var state := "move"
var state_t := 0.0
var facing := Vector2.DOWN
var atk: Dictionary = {}
var atk_dir := Vector2.DOWN
var atk_origin := Vector2.ZERO
var did_hit := false
var riposte := false
var stagger_time := 0.0
var poise_acc := 0.0
var poise_t := 0.0
var cooldown := 0.0
var flash := 0.0
var target_gate := true
var phase := 1
var summon_t := 6.0


func setup(k: String, night: int) -> void:
	kind = k
	def = DEFS[k]
	max_hp = def.hp * (1.0 + 0.08 * (night - 1))
	hp = max_hp
	radius = def.radius
	ash = int(def.ash * (1.0 + 0.1 * (night - 1)))
	cooldown = randf_range(0.2, 0.8)


func is_boss() -> bool:
	return def.get("boss", false)


func windup_time() -> float:
	if atk.is_empty():
		return 0.0
	return atk.windup * (0.75 if phase == 2 else 1.0)


func tick(dt: float, game) -> void:
	state_t += dt
	flash = maxf(0.0, flash - dt)
	cooldown -= dt
	poise_t -= dt
	if poise_t <= 0.0:
		poise_acc = 0.0
	if state == "dead":
		return
	var p: Player = game.player
	target_gate = p.state == "dead" or position.distance_to(p.position) > def.aggro
	var tpos: Vector2 = Combat.GATE_POS if target_gate else p.position
	var to := tpos - position
	var dist := to.length()
	if kind == "lord" and phase == 2:
		summon_t -= dt
		if summon_t <= 0.0:
			summon_t = 11.0
			game.spawn("husk", position + Vector2(randf_range(-30, 30), -12))
	match state:
		"move":
			if dist > 0.01:
				facing = to / dist
			var a = _choose_attack(dist)
			if a != null and cooldown <= 0.0:
				_begin(a, tpos)
			elif dist > (10.0 if target_gate else def.stop):
				position += facing * def.speed * (1.3 if phase == 2 else 1.0) * dt
		"windup":
			# Отслеживание цели только в начале замаха — дальше атака «зафиксирована».
			if atk.type != "aoe" and state_t < windup_time() * 0.6 and dist > 0.01:
				atk_dir = atk_dir.slerp(to / dist, minf(1.0, dt * 6.0))
				facing = atk_dir
			if state_t >= windup_time():
				state = "active"
				state_t = 0.0
				did_hit = false
				if atk.type != "dash":
					game.enemy_strike(self, atk)
					did_hit = true
		"active":
			if atk.type == "dash":
				position += atk_dir * atk.dash * dt
				if not did_hit and game.enemy_strike(self, atk):
					did_hit = true
			if state_t >= atk.active:
				state = "recover"
				state_t = 0.0
		"recover":
			if state_t >= atk.recover:
				state = "move"
				state_t = 0.0
				cooldown = randf_range(0.3, 0.9) * (0.6 if phase == 2 else 1.0)
		"stagger":
			if state_t >= stagger_time:
				state = "move"
				state_t = 0.0
				riposte = false
	position = position.clamp(Combat.ENEMY_MIN, Combat.ENEMY_MAX)
	queue_redraw()


func _choose_attack(dist: float) -> Variant:
	var opts: Array = []
	for a in def.attacks:
		if int(a.get("phase", 1)) > phase:
			continue
		var rng: float = maxf(a.range, 16.0) if target_gate else a.range
		if dist <= rng:
			opts.append(a)
	if opts.is_empty():
		return null
	return opts.pick_random()


func _begin(a: Dictionary, tpos: Vector2) -> void:
	atk = a
	state = "windup"
	state_t = 0.0
	atk_dir = facing
	atk_origin = tpos


func stagger(time: float, can_riposte: bool = false) -> void:
	state = "stagger"
	state_t = 0.0
	stagger_time = time
	riposte = can_riposte


func on_parried(_game) -> void:
	stagger(0.9 if is_boss() else 1.6, true)


func take_damage(dmg: float, poise: float, game, from_player: bool) -> void:
	if state == "dead":
		return
	var crit := riposte and from_player
	if crit:
		dmg *= 3.0
		riposte = false
		game.floater(position + Vector2(0, -24), "КРИТ", Color("ffcd75"))
	hp -= dmg
	flash = 0.1
	game.floater(position + Vector2(randf_range(-4, 4), -14), str(int(dmg)), Color.WHITE)
	poise_acc += poise
	poise_t = 2.0
	if hp <= 0.0:
		hp = 0.0
		state = "dead"
		state_t = 0.0
		game.on_enemy_killed(self)
		return
	var armored := state == "active" or (is_boss() and state == "windup")
	if crit or (poise_acc >= def.poise and not armored and state != "stagger"):
		poise_acc = 0.0
		stagger(0.55)
	if kind == "lord" and phase == 1 and hp < max_hp * 0.5:
		phase = 2
		game.on_boss_phase(self)


func _process(delta: float) -> void:
	if state == "dead":
		state_t += delta
		modulate.a = clampf(1.0 - state_t / 0.6, 0.0, 1.0)
		if state_t >= 0.6:
			queue_free()


func _draw() -> void:
	if state == "windup":
		_draw_telegraph()
	var sc: float = def.get("scale", 1.0)
	draw_rect(Rect2(-radius, -1, radius * 2.0, 2), Color(0, 0, 0, 0.35))
	var glint := state == "windup" and windup_time() - state_t < GLINT_TIME
	var mod := Color(1.0, 0.35, 0.35) if glint else Color.WHITE
	var off := Vector2(sin(state_t * 60.0), 0) if state == "stagger" else Vector2.ZERO
	Sprites.draw(self, Sprites.tex(def.sprite, flash > 0.0), off, facing.x < 0.0, Vector2(sc, sc), mod)
	var top := -Sprites.tex(def.sprite).get_size().y * sc
	if riposte:
		draw_rect(Rect2(-1, top - 8, 2, 4), Color("ffcd75"))
		draw_rect(Rect2(-1, top - 3, 2, 1), Color("ffcd75"))
	if hp < max_hp and not is_boss() and state != "dead":
		draw_rect(Rect2(-5, top - 3, 10, 2), Color("1a1c2c"))
		draw_rect(Rect2(-5, top - 3, 10.0 * hp / max_hp, 1), Color("e43b44"))


func _draw_telegraph() -> void:
	var k := clampf(state_t / maxf(windup_time(), 0.01), 0.0, 1.0)
	var line := Color(1.0, 0.2, 0.15, 0.35 + 0.55 * k)
	var fill := Color(1.0, 0.2, 0.15, 0.08 + 0.17 * k)
	match atk.type:
		"arc":
			var ang := atk_dir.angle()
			var half := deg_to_rad(atk.arc) * 0.5
			var pts := PackedVector2Array([Vector2.ZERO])
			for i in 11:
				pts.append(Vector2.from_angle(ang - half + 2.0 * half * i / 10.0) * atk.reach)
			draw_colored_polygon(pts, fill)
			pts.append(Vector2.ZERO)
			draw_polyline(pts, line, 1.0)
		"aoe":
			var c := atk_origin - position
			draw_circle(c, atk.radius * k, fill)
			draw_arc(c, atk.radius, 0.0, TAU, 32, line, 1.0)
		"dash":
			draw_line(Vector2(0, -3), Vector2(0, -3) + atk_dir * atk.dash * atk.active, line, 1.0)
