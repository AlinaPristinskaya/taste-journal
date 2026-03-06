import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token is missing' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'OK', message: 'Taste Journal API is running' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'ERROR', message: 'Database connection failed' });
  }
});

app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [existingUsers] = await db.execute('SELECT id FROM users WHERE email = ?', [normalizedEmail]);

    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'User with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), normalizedEmail, passwordHash]
    );

    const user = {
      id: result.insertId,
      name: name.trim(),
      email: normalizedEmail
    };

    const token = generateToken(user);

    return res.status(201).json({ user, token });
  } catch (error) {
    console.error('Error during POST /auth/register:', error);
    return res.status(500).json({ message: 'Failed to register user' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [rows] = await db.execute(
      'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const userRow = rows[0];
    const isPasswordValid = await bcrypt.compare(password, userRow.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email
    };

    const token = generateToken(user);

    return res.json({ user, token });
  } catch (error) {
    console.error('Error during POST /auth/login:', error);
    return res.status(500).json({ message: 'Failed to log in' });
  }
});

app.post('/auth/logout', authenticateToken, (_req, res) => {
  return res.json({ message: 'Logged out successfully. Remove token on the client.' });
});

app.get('/posts', async (req, res) => {
  try {
    const { category } = req.query;

    let sql = `
      SELECT
        posts.id,
        posts.user_id,
        posts.title,
        posts.content,
        posts.category,
        posts.created_at,
        posts.updated_at,
        users.name AS author
      FROM posts
      JOIN users ON posts.user_id = users.id
    `;

    const params = [];

    if (category) {
      sql += ' WHERE posts.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY posts.created_at DESC';

    const [rows] = await db.execute(sql, params);
    return res.json(rows);
  } catch (error) {
    console.error('Error during GET /posts:', error);
    return res.status(500).json({ message: 'Failed to fetch posts' });
  }
});

app.get('/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      `
      SELECT
        posts.id,
        posts.user_id,
        posts.title,
        posts.content,
        posts.category,
        posts.created_at,
        posts.updated_at,
        users.name AS author
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error('Error during GET /posts/:id:', error);
    return res.status(500).json({ message: 'Failed to fetch post' });
  }
});

app.get('/categories', async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT DISTINCT category FROM posts WHERE category IS NOT NULL AND category <> "" ORDER BY category ASC'
    );

    return res.json(rows.map((row) => row.category));
  } catch (error) {
    console.error('Error during GET /categories:', error);
    return res.status(500).json({ message: 'Failed to fetch categories' });
  }
});

app.post('/posts', authenticateToken, async (req, res) => {
  try {
    const { title, content, category } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'title and content are required' });
    }

    const normalizedCategory = typeof category === 'string' ? category.trim() : null;

    const [result] = await db.execute(
      'INSERT INTO posts (user_id, title, content, category) VALUES (?, ?, ?, ?)',
      [req.user.id, title.trim(), content, normalizedCategory || null]
    );

    return res.status(201).json({
      id: result.insertId,
      user_id: req.user.id,
      title: title.trim(),
      content,
      category: normalizedCategory || null
    });
  } catch (error) {
    console.error('Error during POST /posts:', error);
    return res.status(500).json({ message: 'Failed to create post' });
  }
});

app.put('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'title and content are required' });
    }

    const normalizedCategory = typeof category === 'string' ? category.trim() : null;

    const [result] = await db.execute(
      `
      UPDATE posts
      SET title = ?, content = ?, category = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
      `,
      [title.trim(), content, normalizedCategory || null, id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Post not found or not owned by current user' });
    }

    return res.json({
      id: Number(id),
      user_id: req.user.id,
      title: title.trim(),
      content,
      category: normalizedCategory || null
    });
  } catch (error) {
    console.error('Error during PUT /posts/:id:', error);
    return res.status(500).json({ message: 'Failed to update post' });
  }
});

app.delete('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.execute('DELETE FROM posts WHERE id = ? AND user_id = ?', [id, req.user.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Post not found or not owned by current user' });
    }

    return res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error during DELETE /posts/:id:', error);
    return res.status(500).json({ message: 'Failed to delete post' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  return res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
