extends Node
## Сохранение прогресса. Одна ячейка, ручных сейвов нет: всё пишется автоматически, как в souls-like.

var path := "user://save.json"
var data: Dictionary = {}


func _ready() -> void:
	load_game()


func defaults() -> Dictionary:
	return {
		"version": 2,
		"started": false,
		"completed": false,
		"beacon_night": 1,
		"ash": 0,
		"dropped_ash": 0,
		"roster": [],
		"fallen": [],
		"next_id": 1,
		"recruits": 0,
		"towers": 0,
		"gate_level": 0,
		"defeats": 0,
	}


func load_game() -> void:
	data = defaults()
	if not FileAccess.file_exists(path):
		return
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return
	var parsed = JSON.parse_string(f.get_as_text())
	if parsed is Dictionary and int(parsed.get("version", 0)) == int(data.version):
		for k in parsed:
			data[k] = parsed[k]


func save_game() -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "\t"))


func reset() -> void:
	data = defaults()
	save_game()
