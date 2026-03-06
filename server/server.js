import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

let db;

async function startServer() {
  try {
    // Подключение к MySQL
    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('Подключение к MySQL прошло успешно!');

    // ======================
    // GET /posts — список постов (с фильтром по категории)
    // ======================
    app.get('/posts', async (req, res) => {
      try {
        const { category } = req.query;

        let sql = `
          SELECT 
            posts.id,
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

        res.json(rows);
      } catch (err) {
        console.error('Ошибка при GET /posts:', err);
        res.status(500).json({ message: 'Failed to fetch posts' });
      }
    });

    // ======================
    // POST /posts — создаём новый рецепт
    // ======================
    app.post('/posts', async (req, res) => {
      try {
        const { user_id, title, content, category } = req.body;

        if (!user_id || !title || !content) {
          return res.status(400).json({ message: 'user_id, title, and content are required' });
        }

        const sql = `
          INSERT INTO posts (user_id, title, content, category)
          VALUES (?, ?, ?, ?)
        `;
        const [result] = await db.execute(sql, [user_id, title, content, category || null]);

        res.status(201).json({
          id: result.insertId,
          user_id,
          title,
          content,
          category: category || null
        });
      } catch (err) {
        console.error('Ошибка при POST /posts:', err);
        res.status(500).json({ message: 'Failed to create post' });
      }
    });

    // ======================
    // PUT /posts/:id — редактируем пост
    // ======================
    app.put('/posts/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { title, content, category } = req.body;

        const sql = `
          UPDATE posts
          SET title = ?, content = ?, category = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        const [result] = await db.execute(sql, [title, content, category, id]);

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Post not found' });
        }

        res.json({ id, title, content, category });
      } catch (err) {
        console.error('Ошибка при PUT /posts/:id:', err);
        res.status(500).json({ message: 'Failed to update post' });
      }
    });

    // ======================
    // DELETE /posts/:id — удаляем пост
    // ======================
    app.delete('/posts/:id', async (req, res) => {
      try {
        const { id } = req.params;

        const sql = 'DELETE FROM posts WHERE id = ?';
        const [result] = await db.execute(sql, [id]);

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Post not found' });
        }

        res.json({ message: 'Post deleted successfully' });
      } catch (err) {
        console.error('Ошибка при DELETE /posts/:id:', err);
        res.status(500).json({ message: 'Failed to delete post' });
      }
    });

    // ======================
    // Слушаем порт
    // ======================
    app.listen(3001, () => {
      console.log('Server running on port 3001');
    });

  } catch (error) {
    console.error('Ошибка запуска сервера:', error);
  }
}

startServer();