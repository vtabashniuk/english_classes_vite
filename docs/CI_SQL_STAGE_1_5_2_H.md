# CRM — SQL-перевірки в GitHub CI (1.5.2h)

## Що додається

До вже обов'язкового job `Quality checks` у `.github/workflows/ci.yml` додано кроки:

1. `supabase/setup-cli@v3` — бере зафіксовану версію CLI з кореневого `package-lock.json`.
2. `supabase db start` — створює тимчасовий локальний PostgreSQL у Docker GitHub runner і застосовує міграції зі сховища.
3. `supabase test db --local` — запускає всі `supabase/tests/database/*.sql` через pgTAP.

Жоден крок не використовує `--linked`, хмарний URL, `service_role` ключ із Production чи команди `db push` / `db reset`. Runner тимчасовий, після завершення GitHub Actions локальна БД зникає разом із ним. Job використовує `contents: read`, `persist-credentials: false`.

Тепер **Quality checks** має ставати зеленим тільки після проходження JS, architecture, lint, build і SQL. У GitHub Ruleset для `main` статус `Quality checks` уже обов'язковий — змінювати назву status check чи додавати новий не потрібно.

## Запуск і перевірка

У гілці `feature/regression-stage-1-5-2`:

```powershell
npm run check:architecture
node --test tests/*.test.js
npm run lint
npm run build
npx supabase test db --local
```

Остання команда потребує запущеного локального Supabase (у вас він уже працює). GitHub runner створює БД самостійно за допомогою `supabase db start`.

Після розпакування ZIP перевірте Git diff, закомітьте **лише три файли цього етапу** й виконайте push. У GitHub → Actions → CRM CI перевірте появу трьох нових кроків та результат SQL-тестів. За поточним локальним набором очікуються 7 файлів і 264 pgTAP-тести, але результат на чистому Linux runner ще потрібно підтвердити.

## Якщо CI зупиниться

- Помилка на `Start isolated local PostgreSQL` може свідчити про неспівпадіння чистої БД із локальною, проблеми з Docker/образом або міграціями. Надішліть повний лог саме цього кроку; не змінюйте Production і не переписуйте застосовані міграції.
- Помилка на `Run local RLS and RPC regression tests` означає, що конкретний SQL-тест або його тестові умови не проходять на чистому runner. Потрібно аналізувати точну SQL-помилку й локально відтворити її.
- **Не** підміняйте цю помилку пропуском SQL-кроків і не змінюйте чинну RLS без доказів дефекту.
- Не робіть merge до успішного запуску `Quality checks` у Pull Request.

Оскільки Docker-образи завантажуються на новий GitHub runner, перший SQL-запуск може бути помітно повільнішим за 4-секундний локальний pgTAP. Максимальний час job збільшено з 20 до 35 хвилин.
