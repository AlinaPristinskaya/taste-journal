# Taste Journal Backend API

Backend for the Full Stack Tech Blog Application challenge (implemented in the recipe domain).

## What is implemented

- Secure auth with JWT:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
- Protected CRUD for user-owned content:
  - `POST /recipes`
  - `PUT /recipes/:id`
  - `DELETE /recipes/:id`
- Read endpoints with filtering:
  - `GET /recipes`
  - `GET /recipes/mine`
  - `GET /recipes/:id`
  - `GET /categories`
- Upload local images for recipes:
  - `POST /upload-image`
- Health endpoint:
  - `GET /health`

## Stack

- Node.js
- Express
- MySQL (`mysql2`)
- JWT (`jsonwebtoken`)
- Password hashing (`bcryptjs`)
- File upload (`multer`)

## Environment variables

Create `server/.env` from `server/.env.example`:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL`
- `PORT`
- `JWT_SECRET`

## Local run

```bash
cd server
npm install
npm start
```

API default: `http://localhost:3001`

## Database setup

Run SQL from:

- `server/schema.sql`

Required tables:

- `users`
- `posts`

## Deployment

This API is deployed on Render and connected to hosted MySQL (Aiven).

## Assignment mapping

Even though the domain is recipes (instead of blog posts), acceptance criteria are covered:

- register/login/logout securely
- create/update/delete own entries
- filter entries by category
- frontend consumes backend API dynamically
