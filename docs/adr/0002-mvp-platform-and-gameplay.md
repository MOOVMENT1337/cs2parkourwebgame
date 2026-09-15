# ADR-0002: Платформа и gameplay MVP

- Статус: принято
- Дата: 2026-09-15

## Решение

- Главная платформа — актуальный desktop Google Chrome с keyboard/mouse и Pointer Lock.
- Игра single-player; real-time multiplayer не входит в MVP.
- Ghost и leaderboard допустимы, потому что не требуют совместной real-time-сессии.
- Прыжок автоматический: удерживаемое действие `jump` срабатывает на первом допустимом simulation tick.
- Другие браузеры, мобильное управление и геймпады оптимизируются после MVP.

## Последствия

Performance budgets, QA matrix и первая система ввода оптимизируются под Chrome. Результаты auto-bhop не смешиваются с будущим manual-профилем, если он когда-либо появится.
