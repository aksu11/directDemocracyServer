# DirectDemocracy Backend — description field

The admin UI includes an optional `description` field for polls. Admins can write plain text or Markdown (links supported).

Behaviour:
- `description` is stored as plain text in Firestore under the poll document.
- When polls are returned via the API, the backend converts Markdown to HTML and sanitizes it. The API returns `descriptionHtml` (sanitized) for safe rendering in clients.
- Images are explicitly disallowed in `descriptionHtml`.
- Maximum length: 2000 characters.

Client guidance (mobile):
- Use `descriptionHtml` when available to render rich content (links will open in a browser).
- Show one-line preview in lists and expand on "Näytä lisää" to render full HTML.

Security notes:
- Backend sanitizes HTML with `sanitize-html` to prevent XSS. Do not render raw `description` without sanitization.

To install new dependencies:
```bash
npm install
```
