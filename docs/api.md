# The API

Other apps, such as Home Assistant, can read your lists and change them through a small API under `/api/v1`: list the lists and their items, add an item by name, check one off or uncheck it, and take it off the list. A change made through it is stored as if you had made it in the app, and the app shows it at its next sync.

## Make a token

In **Settings**, open **Connected apps** and make a token, with a name that says where it goes, such as Home Assistant. The token starts with `pr_` and shows once: copy it into the other app then.

- **What it can do:** read and change the lists of your household, as you. It can't change your account, your household's members, invites or share links.
- **How long it works:** until you revoke it under **Connected apps**, or after 400 days without use.
- **If you move:** a token follows its account. Leave or be removed from a household, and it sees the lists you have next, not the old ones.

## Send it

Every request carries the token in an `Authorization` header:

```sh
PROMUS_TOKEN=pr_Xq3vT8mKd2LwR9yBn5cHf7JpZ4sGa1eUo6iVk0tNbYw
curl -H "Authorization: Bearer $PROMUS_TOKEN" https://promus.example.se/api/v1/lists
```

A browser session doesn't work here, and a token works only as this header, never as a cookie.

## Routes

| Request | Does | Answers |
|---|---|---|
| `GET /api/v1/lists` | The household's lists | `200` |
| `GET /api/v1/lists/{listId}/items` | What's on a list | `200` |
| `POST /api/v1/lists/{listId}/items` | Adds an item by name | `201`, or `200` when it's on the list already |
| `PATCH /api/v1/lists/{listId}/items/{itemId}` | Checks an item off, or unchecks it | `200` |
| `DELETE /api/v1/lists/{listId}/items/{itemId}` | Takes an item off the list | `204` |

Bodies are JSON, at most 4 KB.

### The lists

```sh
curl -H "Authorization: Bearer $PROMUS_TOKEN" https://promus.example.se/api/v1/lists
```

```json
{ "lists": [{ "id": "3f2b8c1e-5d4a-4e7b-9a6c-2b1d0e9f8a7c", "name": "Inköpslista", "toGet": 3 }] }
```

In name order. `toGet` counts what's left to get, without what's under Later.

### What's on a list

```sh
curl -H "Authorization: Bearer $PROMUS_TOKEN" \
  https://promus.example.se/api/v1/lists/3f2b8c1e-5d4a-4e7b-9a6c-2b1d0e9f8a7c/items
```

```json
{
  "items": [
    { "id": "8c7d6e5f-4a3b-4c2d-8e1f-0a9b8c7d6e5f", "name": "Bröd", "checked": false, "later": false, "quantity": 2, "note": "Fullkorn" },
    { "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "name": "Smör", "checked": false, "later": true, "quantity": 1, "note": null },
    { "id": "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a", "name": "Ägg", "checked": true, "later": false, "quantity": 1, "note": null }
  ]
}
```

In the app's order: what's left to get, by name, then what's under Later, then Done, newest first. Done holds what was checked off in the last 24 hours.

| Field | What it is |
|---|---|
| `id` | The item's id. An item keeps it on every list and every trip. |
| `name` | The item's name. |
| `checked` | `true` when it's in Done. |
| `later` | `true` when it's put off under Later. A checked item is never under Later. |
| `quantity` | How many, 1 or more. |
| `note` | The note on the list, or `null`. |

Two phones that made the same item offline end up with one item and two ids. Either id works in a request, and the answer has the one that's kept.

### Add an item by name

```sh
curl -H "Authorization: Bearer $PROMUS_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "mjölk"}' \
  https://promus.example.se/api/v1/lists/3f2b8c1e-5d4a-4e7b-9a6c-2b1d0e9f8a7c/items
```

The answer is the item, as above. Adding works as typing the name in the app does:
- **Never a duplicate:** case and extra spaces don't matter, so `"  MJÖLK "` is Mjölk. Accents do: `"lok"` is a new item beside Lök.
- **Something bought before** comes back, with the note and quantity it had last time: `201`.
- **Already on the list:** nothing changes, `200`. An item under Later moves back up, `201`.
- **A new name** makes a new item, `201`.

The name is 1 to 200 characters after trimming.

### Check off or uncheck

```sh
curl -X PATCH -H "Authorization: Bearer $PROMUS_TOKEN" -H "Content-Type: application/json" \
  -d '{"checked": true}' \
  https://promus.example.se/api/v1/lists/3f2b8c1e-5d4a-4e7b-9a6c-2b1d0e9f8a7c/items/8c7d6e5f-4a3b-4c2d-8e1f-0a9b8c7d6e5f
```

`"checked": false` unchecks it. The answer is the item. Asking for what it is already changes nothing and answers the same. A change through the API wins over every change the server already has, even one from a phone whose clock is ahead.

### Take an item off the list

```sh
curl -X DELETE -H "Authorization: Bearer $PROMUS_TOKEN" \
  https://promus.example.se/api/v1/lists/3f2b8c1e-5d4a-4e7b-9a6c-2b1d0e9f8a7c/items/8c7d6e5f-4a3b-4c2d-8e1f-0a9b8c7d6e5f
```

The item stays in the household's history, so adding its name brings it back.

## Errors

An error answers with a code, such as `{"error": "not_found"}`.

| Status | `error` | When |
|---|---|---|
| `400` | `invalid_request` | The body isn't JSON or doesn't fit: an empty name, a name over 200 characters, a field the route doesn't take. |
| `401` | `unauthenticated` | No token, or one that's unknown, revoked or expired. |
| `403` | `forbidden` | A browser session instead of a token, or a token without the scope the route needs. |
| `404` | `not_found` | The list isn't one of your household's, or was deleted, or the item isn't on the list. |
| `413` | `payload_too_large` | A body over 4 KB. |
| `500` | `internal` | Something went wrong on the server. Its log says what. |

A token has two scopes: `lists:read` for the `GET` routes and `lists:write` for the others. Tokens made in **Connected apps** have both.
