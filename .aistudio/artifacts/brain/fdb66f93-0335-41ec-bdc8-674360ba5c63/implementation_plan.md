# Dual Token & Cookie Authentication for Iframe Compatibility

Resolve the login redirection issue where demo credentials (`admin` / `admin123` and `user` / `password`) appear to fail inside the AI Studio preview due to modern browser third-party cookie restrictions in cross-origin iframes.

### User Review & Critical Decisions

> [!IMPORTANT]
> The issue has been diagnosed: when running in an `<iframe>`, modern browsers discard or block third-party cookies on subsequent document navigations (`/files`). As a result, the server receives no session cookie and immediately redirects back to `/login`. We will implement dual-mode authentication: client-side token storage (`localStorage` / `sessionStorage`) and `Authorization: Bearer <token>` headers working seamlessly alongside existing HTTP-only cookies.

- **Confirmed Decision**: Dual token and cookie support for full iframe compatibility without changing visual styling or adding heavy external dependencies.
- **Backward Compatibility**: Standard standalone tabs will continue to use cookies, while iframe contexts will seamlessly use the client token fallback.

---

### 1. Overview & Core Concept

- **What It Does**: Allows users to log in with `admin` / `admin123` or `user` / `password` and immediately access the directory browser view (`/files`) without being kicked back to `/login`.
- **Target Audience**: Developers and users browsing remote directories securely inside embedded AI Studio previews or standalone browser windows.
- **Key Value**: 100% reliable session persistence regardless of browser third-party cookie blocking policies.

---

### 2. User Experience & Visual Design

- **Login Flow**:
  1. User enters demo credentials (`admin` / `admin123` or `user` / `password`) on `/login`.
  2. Login button displays "Logging in...".
  3. Backend validates credentials, creates an in-memory session, sets the cookie, and returns the session token in the JSON response payload.
  4. Frontend persists the session token in `localStorage` / `sessionStorage`.
  5. Frontend navigates to `/files?token=<token>`.
  6. `/files` validates either the cookie OR the query token, serving the directory browser UI.
- **Directory Browsing Flow**:
  1. Frontend retrieves directory contents via `/api/list?path=...` sending `Authorization: Bearer <token>` alongside credentials.
  2. Filtering, sorting, and subdirectory navigation remain fast and reactive.
- **Logout Flow**:
  1. Clicking "Logout" clears the cookie and removes the token from client storage.
  2. Redirects cleanly back to `/login`.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual-Mode Token & Cookie Resolution**
  - *Chosen Approach*: The server's authentication resolver inspects `req.cookies.session`, `req.headers.authorization` (`Bearer <token>`), and `req.query.token` (for HTML page transitions).
  - *Why*: Solves third-party cookie suppression in cross-origin iframes without disabling cookie security for top-level browser tabs.
  - *Alternatives Considered*: Disabling authentication completely (rejected because it removes key project features) or relying solely on URL query strings (less secure for persistent browsing).

- **Decision 2: Preserving Original UI & Zero Framework Bloat**
  - *Chosen Approach*: Retain the original HTML/CSS styling in `/static` and enhance client utility functions in `/static/app.js` and `/static/files.html`.
  - *Why*: Adheres strictly to the import migration scope restrictions (no restyling, no visual regression).

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser / Iframe                      │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │      login.html       │       │      files.html       │  │
│  │  Stores token in      │       │  Reads token & sends  │  │
│  │  localStorage         │       │  Authorization header │  │
│  └───────────┬───────────┘       └───────────┬───────────┘  │
└──────────────┼───────────────────────────────┼──────────────┘
               │ POST /api/login               │ GET /api/list
               │ (returns {token})             │ (Bearer <token> + Cookie)
               ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Node.js Express Server                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                Token Extractor Middleware             │  │
│  │     1. req.cookies?.session                           │  │
│  │     2. req.headers.authorization ('Bearer <token>')   │  │
│  │     3. req.query?.token                               │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │ Validates                    │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 SessionManager (RAM)                  │  │
│  │   Map<token, { username, createdAt, expiresAt }>     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Proposed Implementation Steps:
1. **Server Updates (`server.ts`)**:
   - Update `getSessionToken(req)` to extract tokens from `req.cookies?.session`, `req.headers.authorization` (`Bearer ...`), or `req.query.token`.
   - Update `/api/login` response to return `{ success: true, message: "Login successful", token }`.
   - Update `GET /files` route to recognize `req.query.token`.
2. **Frontend Updates (`static/app.js`, `static/login.html`, `static/files.html`)**:
   - In `app.js`: provide unified token management helpers (`getToken()`, `setToken()`, `clearToken()`).
   - In `login.html`: on successful login, save `data.token` to `localStorage` and redirect to `/files?token=${data.token}`.
   - In `files.html`: attach `Authorization: Bearer ${token}` to all `/api/list` requests.
3. **Verification**:
   - Verify dev server compilation and test login flow via CLI simulation.
