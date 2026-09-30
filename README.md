# Пепел Кордона

Хардкорная экшен-оборона в духе souls-like. Делается на **Godot 4.5** под **Steam** (Windows, Linux, Steam Deck).

Ты — опальный принц в крепости Кордон на краю Озера Чудовищ. Каждую ночь из воды выходят твари.
Сражайся сам: перекаты, парирования, выносливость. Погибнешь — весь пепел останется на поле боя.

Подробности — в [дизайн-документе](docs/GDD.md). План выхода в Steam — в [docs/STEAM.md](docs/STEAM.md).

## Управление

| Действие | Клавиатура / мышь | Геймпад |
|----------|-------------------|---------|
| Движение | WASD / стрелки | левый стик |
| Удар (комбо ×3) | J / ЛКМ | X |
| Перекат | Пробел | B |
| Парирование | K / ПКМ | LB |
| Фляга | R | Y |
| Подтвердить | E / Enter | A |
| Пауза | Esc | Start |
| Полный экран | F11 | — |

## Разработка

```bash
godot --editor project.godot                  # открыть в редакторе
godot --headless res://tests/tests.tscn       # автотесты (код выхода 0 = всё ок)
godot --headless --export-release "Windows" build/windows/PepelKordona.exe
godot --headless --export-release "Linux"   build/linux/PepelKordona.x86_64
```

GitHub Actions при каждом пуше прогоняет тесты и собирает Windows- и Linux-версии (вкладка **Actions** → артефакты).

## Структура

- `scripts/game.gd` — ночи, маяки, цикл смерти, HUD и меню
- `scripts/player.gd` — принц: бой, перекат, парирование, фляги
- `scripts/enemy.gd` — враги и босс, телеграфы атак
- `scripts/save.gd` — автосохранение
- `tests/` — автотесты и снятие скриншотов
