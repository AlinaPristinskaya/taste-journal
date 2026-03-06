import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed'));
  }
});

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
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
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function mapRecipePayload(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : null;
  const sourceType = input.source_type === 'external' ? 'external' : 'manual';
  const externalId = typeof input.external_id === 'string' ? input.external_id.trim() : null;
  const imageUrl = typeof input.image_url === 'string' ? input.image_url.trim() : null;
  const sourceUrl = typeof input.source_url === 'string' ? input.source_url.trim() : null;

  let content = typeof input.content === 'string' ? input.content.trim() : '';

  if (!content && sourceType === 'external') {
    content = 'Imported from external source';
  }

  return {
    title,
    content,
    category: category || null,
    source_type: sourceType,
    external_id: externalId || null,
    image_url: imageUrl || null,
    source_url: sourceUrl || null
  };
}

async function listRecipes({ category, sourceType, userId }) {
  let sql = `
    SELECT
      posts.id,
      posts.user_id,
      posts.title,
      posts.content,
      posts.category,
      posts.source_type,
      posts.external_id,
      posts.image_url,
      posts.source_url,
      posts.created_at,
      posts.updated_at,
      users.name AS author
    FROM posts
    JOIN users ON posts.user_id = users.id
  `;

  const params = [];
  const where = [];

  if (category) {
    where.push('posts.category = ?');
    params.push(category);
  }

  if (sourceType && (sourceType === 'manual' || sourceType === 'external')) {
    where.push('posts.source_type = ?');
    params.push(sourceType);
  }

  if (Number.isInteger(userId)) {
    where.push('posts.user_id = ?');
    params.push(userId);
  }

  if (where.length > 0) {
    sql += ` WHERE ${where.join(' AND ')}`;
  }

  sql += ' ORDER BY posts.created_at DESC';

  const [rows] = await db.execute(sql, params);
  return rows;
}

async function getRecipeById(id) {
  const [rows] = await db.execute(
    `
    SELECT
      posts.id,
      posts.user_id,
      posts.title,
      posts.content,
      posts.category,
      posts.source_type,
      posts.external_id,
      posts.image_url,
      posts.source_url,
      posts.created_at,
      posts.updated_at,
      users.name AS author
    FROM posts
    JOIN users ON posts.user_id = users.id
    WHERE posts.id = ?
    `,
    [id]
  );

  return rows[0] || null;
}

async function createRecipe(userId, payload) {
  const [result] = await db.execute(
    `
    INSERT INTO posts
      (user_id, title, content, category, source_type, external_id, image_url, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      payload.title,
      payload.content,
      payload.category,
      payload.source_type,
      payload.external_id,
      payload.image_url,
      payload.source_url
    ]
  );

  return {
    id: result.insertId,
    user_id: userId,
    ...payload
  };
}

async function updateRecipe(recipeId, userId, payload) {
  const [result] = await db.execute(
    `
    UPDATE posts
    SET
      title = ?,
      content = ?,
      category = ?,
      source_type = ?,
      external_id = ?,
      image_url = ?,
      source_url = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
    `,
    [
      payload.title,
      payload.content,
      payload.category,
      payload.source_type,
      payload.external_id,
      payload.image_url,
      payload.source_url,
      recipeId,
      userId
    ]
  );

  return result.affectedRows > 0;
}

async function removeRecipe(recipeId, userId) {
  const [result] = await db.execute('DELETE FROM posts WHERE id = ? AND user_id = ?', [recipeId, userId]);
  return result.affectedRows > 0;
}

function registerRecipeCrud(basePath) {
  app.get(basePath, async (req, res) => {
    try {
      const rows = await listRecipes({
        category: req.query.category,
        sourceType: req.query.source_type,
        userId: null
      });

      return res.json(rows);
    } catch (error) {
      console.error(`Error during GET ${basePath}:`, error);
      return res.status(500).json({ message: 'Failed to fetch recipes' });
    }
  });

  app.get(`${basePath}/mine`, authenticateToken, async (req, res) => {
    try {
      const rows = await listRecipes({
        category: req.query.category,
        sourceType: req.query.source_type,
        userId: req.user.id
      });

      return res.json(rows);
    } catch (error) {
      console.error(`Error during GET ${basePath}/mine:`, error);
      return res.status(500).json({ message: 'Failed to fetch own recipes' });
    }
  });

  app.get(`${basePath}/:id`, async (req, res) => {
    try {
      const recipe = await getRecipeById(req.params.id);

      if (!recipe) {
        return res.status(404).json({ message: 'Recipe not found' });
      }

      return res.json(recipe);
    } catch (error) {
      console.error(`Error during GET ${basePath}/:id:`, error);
      return res.status(500).json({ message: 'Failed to fetch recipe' });
    }
  });

  app.post(basePath, authenticateToken, async (req, res) => {
    try {
      const payload = mapRecipePayload(req.body);

      if (!payload.title || !payload.content) {
        return res.status(400).json({ message: 'title and content are required' });
      }

      if (payload.source_type === 'external' && payload.external_id) {
        const [existing] = await db.execute(
          'SELECT id FROM posts WHERE user_id = ? AND source_type = ? AND external_id = ?',
          [req.user.id, 'external', payload.external_id]
        );

        if (existing.length > 0) {
          return res.status(409).json({ message: 'This external recipe is already saved' });
        }
      }

      const created = await createRecipe(req.user.id, payload);
      return res.status(201).json(created);
    } catch (error) {
      console.error(`Error during POST ${basePath}:`, error);
      return res.status(500).json({ message: 'Failed to create recipe' });
    }
  });

  app.put(`${basePath}/:id`, authenticateToken, async (req, res) => {
    try {
      const payload = mapRecipePayload(req.body);

      if (!payload.title || !payload.content) {
        return res.status(400).json({ message: 'title and content are required' });
      }

      const updated = await updateRecipe(req.params.id, req.user.id, payload);

      if (!updated) {
        return res.status(404).json({ message: 'Recipe not found or not owned by current user' });
      }

      return res.json({ id: Number(req.params.id), user_id: req.user.id, ...payload });
    } catch (error) {
      console.error(`Error during PUT ${basePath}/:id:`, error);
      return res.status(500).json({ message: 'Failed to update recipe' });
    }
  });

  app.delete(`${basePath}/:id`, authenticateToken, async (req, res) => {
    try {
      const deleted = await removeRecipe(req.params.id, req.user.id);

      if (!deleted) {
        return res.status(404).json({ message: 'Recipe not found or not owned by current user' });
      }

      return res.json({ message: 'Recipe deleted successfully' });
    } catch (error) {
      console.error(`Error during DELETE ${basePath}/:id:`, error);
      return res.status(500).json({ message: 'Failed to delete recipe' });
    }
  });
}

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'OK', message: 'Taste Journal API is running' });
  } catch (error) {
    console.error('Health check failed:', error);
    return res.status(500).json({ status: 'ERROR', message: 'Database connection failed' });
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

app.post('/upload-image', authenticateToken, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Image file is required' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;

  return res.status(201).json({
    image_url: imageUrl
  });
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

registerRecipeCrud('/recipes');
registerRecipeCrud('/posts');

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Image is too large. Max size is 5MB.' });
    }
    return res.status(400).json({ message: err.message });
  }

  if (err?.message === 'Only image files are allowed') {
    return res.status(400).json({ message: err.message });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
