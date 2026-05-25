# Правила проекта rw-ticket-watch

Этот проект использует общий Telegram-мост рабочей папки Codex:

`E:\CodexProj\codex-telegram.ps1`

Codex должен по умолчанию использовать мост для:

- уведомлений о завершении этапов и задач;
- запросов на локальные разрешения, которые можно согласовать через Telegram;
- уведомлений о системных approval Codex, которые нельзя подтвердить через Telegram;
- отправки ссылок, файлов, статусов и готовых артефактов;
- чтения входящих Telegram-сообщений и задач для этого проекта.

Типовые команды из корня проекта:

```powershell
E:\CodexProj\codex-telegram.ps1 notify --message "Этап завершен"
E:\CodexProj\codex-telegram.ps1 request-approval --title "Запуск проверки" --details "Нужно выполнить команду для проекта"
E:\CodexProj\codex-telegram.ps1 codex-approval-needed --title "Sandbox approval" --details "Подтверждение возможно только в интерфейсе Codex"
E:\CodexProj\codex-telegram.ps1 check-similar --title "Запуск проверки"
E:\CodexProj\codex-telegram.ps1 read-inbox --limit 20
E:\CodexProj\codex-telegram.ps1 open-tasks --limit 20
E:\CodexProj\codex-telegram.ps1 send-link --title "Готовая ссылка" --url "https://example.com"
```

Перед повторяющимся действием сначала проверять сохраненное согласие через `check-similar`. Если правило уже есть, продолжать без лишнего вопроса, если это не противоречит системным ограничениям Codex и не связано с рисками.

Системные approval Codex все равно запрашиваются через интерфейс Codex. Если такое разрешение появилось и его нельзя заменить Telegram-согласием, сначала отправить уведомление через `codex-approval-needed`, затем запросить системное разрешение штатным способом.

Когда пришла Telegram-задача, поставить ей статус `started`, выполнить работу в проекте, запустить доступные проверки, отправить краткий статус через `notify`, затем поставить статус `done`.
