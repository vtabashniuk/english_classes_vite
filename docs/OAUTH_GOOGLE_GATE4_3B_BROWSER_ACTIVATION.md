# Gate 4.3-B — перевірка RPC із реальною Google-сесією (LOCAL ONLY)

## Передумови

- `feature/google-oauth-gate4` — поточна гілка; Gate 4.3-A міграцію застосовано **локально**, усі 459 SQL-тестів PASS.
- Локальний Supabase працює на `127.0.0.1:54321` (API), `:54322` (DB), `:54323` (Studio).
- Локальні `[auth.hook.before_user_created]` і `[auth.external.google]` активні; Google Client Secret уже передано під час локального `supabase start`.
- Google OAuth Web Client має redirect URI `http://127.0.0.1:54321/auth/v1/callback`. Локальний `[auth].site_url` — `http://127.0.0.1:3000`.
- Існуючий тестовий Google-користувач UUID `00af286e-836d-46fb-830d-d28507c5a550`; pending-запрошення UUID `10726e13-a472-49d1-84b0-93baf300054d`.
- **Не змінюй .env.local**, не запускай `db reset` і не застосовуй міграції до linked Production.

## Read-only preflight (LOCAL Studio)

```sql
SELECT i.status, i.accepted_user_id, i.expires_at > now() AS not_expired,
       count(ts.student_id) FILTER (WHERE ts.is_active) AS active_teacher_links
FROM crm_private.pending_google_invitations i
LEFT JOIN public.teacher_students ts
  ON ts.student_id = '00af286e-836d-46fb-830d-d28507c5a550'::uuid
WHERE i.id = '10726e13-a472-49d1-84b0-93baf300054d'::uuid
GROUP BY i.id, i.status, i.accepted_user_id, i.expires_at;
```

Очікуємо: `pending`, `NULL`, `true`, `0`. Якщо інше — припини тест, нічого не видаляй і не виправляй дані вручну.

## Запуск лише тестового інтерфейсу

У **новому** PowerShell із кореня CRM:

```powershell
cd D:\Projects\english_classes_vite
npx vite scripts/oauth-gate4-activation-harness --host 127.0.0.1 --port 3000 --strictPort
```

Важливо, щоб Vite справді працював на `127.0.0.1:3000`. Не запускай повну CRM: ця тестова сторінка не змінює маршрути email-авторизації. Vite використовує вже встановлений npm-пакет `@supabase/supabase-js`; нових npm-залежностей немає.

Відкрий **нове InPrivate** вікно браузера та зайди на `http://127.0.0.1:3000/`.

1. З `npx supabase status` візьми **локальний Publishable / anon key** (не `Secret`/`service_role` і не Google Client Secret). Встав у поле «Локальний Publishable / anon key» і натисни «Підключити». Значення тимчасово зберігається лише у `sessionStorage` вкладки для повернення з OAuth.
2. Натисни «Увійти через Google» і вибери той самий тестовий Google-акаунт. Повернення йде на **запущений** локальний тестовий інтерфейс. Сесія обробляється бібліотекою Supabase JS через PKCE; не копіюй токени або callback URL.
3. Переконайся, що відображається `Google identity: так` та `Очікуваний тестовий UUID: збігається`.
4. Натисни «Переглянути мої запрошення». Тестова сторінка викликає `list_my_google_invitation_choices()` через JWT поточного Google-користувача й показує ім’я викладача, UUID та строк дії.
5. **Точка зупинки:** переглянь результат і підтверди, що це потрібний тестовий викладач. Натискати «Прийняти» не обов’язково в той самий прохід. Якщо вирішуєш завершити позитивний сценарій — постав галочку, натисни «Прийняти це запрошення» та підтверди системний діалог. Лише тоді викликається `accept_my_pending_google_invitation(...)`.
6. Якщо бачиш код `GOOGLE_INVITATION_*`, запиши тільки код помилки без токенів і зупинися. Не повторюй прийняття навмання.

## Контроль результату (read-only SQL після явного прийняття)

```sql
SELECT i.status AS invitation_status,
       i.accepted_user_id = '00af286e-836d-46fb-830d-d28507c5a550'::uuid AS accepted_by_expected_user,
       i.accepted_at IS NOT NULL AS has_accepted_at,
       (SELECT count(*)
        FROM public.teacher_students ts
        WHERE ts.student_id = '00af286e-836d-46fb-830d-d28507c5a550'::uuid
          AND ts.teacher_id = i.teacher_id AND ts.is_active = true
       ) AS chosen_active_teacher_links,
       (SELECT count(*)
        FROM public.teacher_students ts
        WHERE ts.student_id = '00af286e-836d-46fb-830d-d28507c5a550'::uuid
          AND ts.is_active = true
       ) AS all_active_teacher_links
FROM crm_private.pending_google_invitations i
WHERE i.id = '10726e13-a472-49d1-84b0-93baf300054d'::uuid;
```

Очікуємо: `accepted`, `true`, `true`, `1`, `1`. Після цього кнопка перегляду запрошень має повертати 0 доступних запрошень.

**Не застосовувати до Production.** Ця сторінка — лише тестовий інструмент, не готовий інтерфейс CRM. Її не додавати до production `src/router.jsx` або загального Vite build. Після проходу зупини тестовий Vite (`Ctrl+C`) та закрий InPrivate-вікно; локального Auth-користувача/запрошення не видаляй.
