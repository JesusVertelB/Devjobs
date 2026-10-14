require('dotenv').config();

const path = require('node:path');
const bcrypt = require('bcryptjs');
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const requiredVariables = ['DB_HOST', 'DB_NAME', 'DB_USER', 'JWT_SECRET'];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);
if (missingVariables.length) {
  throw new Error(`Faltan variables en .env: ${missingVariables.join(', ')}`);
}
if (process.env.DB_PASSWORD === undefined) {
  throw new Error('Define DB_PASSWORD en .env; déjalo vacío solo si tu usuario MySQL no tiene contraseña.');
}
if (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('replace-with-')) {
  throw new Error('JWT_SECRET debe ser un secreto aleatorio de al menos 32 caracteres.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

const app = express();
const port = Number(process.env.PORT || 3000);
const publicFiles = new Set([
  'index.html',
  'Empleos.html',
  'Empresas.html',
  'Salarios.html',
  'DetalleEmpleo.html',
  'PublicarEmpleo.html',
  'IniciarSesion.html',
  'site-header.js',
  'style.css',
  'tailwind.css',
  'background.webp'
]);
const workModes = new Set(['remote', 'hybrid', 'onsite']);
const employmentTypes = new Set(['full_time', 'part_time', 'contract']);
const accountTypes = new Set(['candidate', 'employer']);
const categoryNames = {
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Datos',
  design: 'Diseño de producto',
  devops: 'DevOps'
};

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

function createToken(user) {
  return jwt.sign(
    { sub: String(user.id), accountType: user.account_type },
    process.env.JWT_SECRET,
    { expiresIn: '8h', issuer: 'devjobs' }
  );
}

function readToken(req) {
  const authorization = req.get('authorization') || '';
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return jwt.verify(token, process.env.JWT_SECRET, { issuer: 'devjobs' });
}

function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    req.user = token;
    next();
  } catch {
    return res.status(401).json({ error: 'La sesión no es válida o ha expirado.' });
  }
}

function requireEmployer(req, res, next) {
  if (req.user.accountType !== 'employer' && req.user.accountType !== 'admin') {
    return res.status(403).json({ error: 'Necesitas una cuenta de empresa para publicar vacantes.' });
  }
  next();
}

function asTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function sendApiError(res, error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(400).json({ error: 'La referencia indicada no existe o está en uso.' });
  }
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'La sesión no es válida o ha expirado.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Ocurrió un error al procesar la solicitud.' });
}

app.get('/api/health', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT DATABASE() AS databaseName');
    res.json({ status: 'ok', database: rows[0].databaseName });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post('/api/auth/register', async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const accountType = String(req.body.accountType || 'candidate');

  if (fullName.length < 2 || fullName.length > 120) {
    return res.status(400).json({ error: 'Escribe un nombre de entre 2 y 120 caracteres.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (!accountTypes.has(accountType)) {
    return res.status(400).json({ error: 'El tipo de cuenta no es válido.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (full_name, email, password_hash, account_type) VALUES (?, ?, ?, ?)',
      [fullName, email, passwordHash, accountType]
    );
    const user = { id: result.insertId, full_name: fullName, email, account_type: accountType };
    res.status(201).json({ token: createToken(user), user });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Escribe tu correo y contraseña.' });

  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, password_hash, account_type, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'El correo o la contraseña no son correctos.' });
    }
    const publicUser = { id: user.id, full_name: user.full_name, email: user.email, account_type: user.account_type };
    res.json({ token: createToken(user), user: publicUser });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, account_type FROM users WHERE id = ? AND is_active = TRUE LIMIT 1',
      [req.user.sub]
    );
    if (!rows[0]) return res.status(401).json({ error: 'La cuenta ya no está activa.' });
    res.json({ user: rows[0] });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get('/api/jobs', async (req, res) => {
  const clauses = ["j.status = 'published'"];
  const params = [];
  const query = String(req.query.q || '').trim();
  const category = String(req.query.category || '');
  const mode = String(req.query.mode || '');
  const type = String(req.query.type || '');

  if (query) {
    clauses.push('(j.title LIKE ? OR c.name LIKE ? OR j.location LIKE ? OR j.description LIKE ?)');
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  if (category) {
    clauses.push('jc.slug = ?');
    params.push(category);
  }
  if (mode && workModes.has(mode)) {
    clauses.push('j.work_mode = ?');
    params.push(mode);
  }
  if (type && employmentTypes.has(type)) {
    clauses.push('j.employment_type = ?');
    params.push(type);
  }

  try {
    const [rows] = await pool.execute(
      `SELECT j.id, j.title, j.location, j.work_mode, j.employment_type,
        j.salary_min, j.salary_max, j.salary_currency, j.description,
        j.published_at, c.name AS company, jc.slug AS category,
        (SELECT GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ',')
         FROM job_skills js JOIN skills s ON s.id = js.skill_id
         WHERE js.job_id = j.id) AS skills
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       JOIN job_categories jc ON jc.id = j.category_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY j.published_at DESC, j.id DESC
       LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'El identificador de la vacante no es válido.' });

  try {
    const [rows] = await pool.execute(
      `SELECT j.id, j.title, j.location, j.work_mode, j.employment_type,
        j.salary_min, j.salary_max, j.salary_currency, j.description,
        j.published_at, c.name AS company, jc.slug AS category
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       JOIN job_categories jc ON jc.id = j.category_id
       WHERE j.id = ? AND j.status = 'published'
       LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontramos esa vacante.' });

    const [bullets] = await pool.execute(
      'SELECT bullet_type, content FROM job_bullets WHERE job_id = ? ORDER BY bullet_type, sort_order, id',
      [req.params.id]
    );
    const [skills] = await pool.execute(
      `SELECT s.name FROM skills s JOIN job_skills js ON js.skill_id = s.id
       WHERE js.job_id = ? ORDER BY s.name`,
      [req.params.id]
    );
    const job = rows[0];
    job.responsibilities = bullets.filter((item) => item.bullet_type === 'responsibility').map((item) => item.content);
    job.requirements = bullets.filter((item) => item.bullet_type === 'requirement').map((item) => item.content);
    job.benefits = bullets.filter((item) => item.bullet_type === 'benefit').map((item) => item.content);
    job.skills = skills.map((item) => item.name);
    res.json(job);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post('/api/jobs', requireAuth, requireEmployer, async (req, res) => {
  const body = req.body;
  const title = String(body.title || '').trim();
  const company = String(body.company || '').trim();
  const location = String(body.location || '').trim();
  const contactEmail = String(body.contactEmail || '').trim().toLowerCase();
  const description = String(body.description || '').trim();
  const category = String(body.category || '');
  const mode = String(body.mode || '');
  const type = String(body.type || '');
  const salaryMin = body.salaryMin === null || body.salaryMin === '' ? null : Number(body.salaryMin);
  const salaryMax = body.salaryMax === null || body.salaryMax === '' ? null : Number(body.salaryMax);
  const responsibilities = asTextList(body.responsibilities);
  const requirements = asTextList(body.requirements);
  const benefits = asTextList(body.benefits);
  const tags = asTextList(body.tags).slice(0, 20);

  if (!title || title.length > 140 || !company || company.length > 160 || !location || location.length > 160 || !description) {
    return res.status(400).json({ error: 'Completa el nombre del puesto, empresa, ubicación y descripción.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return res.status(400).json({ error: 'El correo de contacto no es válido.' });
  if (!categoryNames[category] || !workModes.has(mode) || !employmentTypes.has(type)) {
    return res.status(400).json({ error: 'Selecciona un área, modalidad y tipo de empleo válidos.' });
  }
  if (!responsibilities.length || !requirements.length) {
    return res.status(400).json({ error: 'Agrega al menos una responsabilidad y un requisito.' });
  }
  if ((salaryMin === null) !== (salaryMax === null) || (salaryMin !== null && (!Number.isFinite(salaryMin) || !Number.isFinite(salaryMax) || salaryMin < 0 || salaryMax < salaryMin))) {
    return res.status(400).json({ error: 'El rango salarial debe tener ambos valores y el máximo no puede ser menor al mínimo.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [categoryRows] = await connection.execute('SELECT id FROM job_categories WHERE slug = ? LIMIT 1', [category]);
    if (!categoryRows[0]) {
      await connection.rollback();
      return res.status(400).json({ error: 'El área elegida no existe en la base de datos.' });
    }

    const [companyRows] = await connection.execute(
      'SELECT id FROM companies WHERE owner_user_id = ? AND name = ? LIMIT 1',
      [req.user.sub, company]
    );
    let companyId = companyRows[0]?.id;
    if (!companyId) {
      const [companyResult] = await connection.execute(
        'INSERT INTO companies (owner_user_id, name, industry, location) VALUES (?, ?, ?, ?)',
        [req.user.sub, company, categoryNames[category], location]
      );
      companyId = companyResult.insertId;
    }

    const [jobResult] = await connection.execute(
      `INSERT INTO jobs (company_id, created_by_user_id, category_id, title, location,
        work_mode, employment_type, salary_min, salary_max, description, contact_email,
        status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)`,
      [companyId, req.user.sub, categoryRows[0].id, title, location, mode, type, salaryMin, salaryMax, description, contactEmail]
    );

    const jobId = jobResult.insertId;
    for (const [bulletType, items] of [
      ['responsibility', responsibilities],
      ['requirement', requirements],
      ['benefit', benefits]
    ]) {
      for (const [index, content] of items.entries()) {
        await connection.execute(
          'INSERT INTO job_bullets (job_id, bullet_type, content, sort_order) VALUES (?, ?, ?, ?)',
          [jobId, bulletType, content.slice(0, 500), index]
        );
      }
    }

    for (const tag of tags) {
      const [skillResult] = await connection.execute(
        'INSERT INTO skills (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
        [tag.slice(0, 80)]
      );
      await connection.execute('INSERT IGNORE INTO job_skills (job_id, skill_id) VALUES (?, ?)', [jobId, skillResult.insertId]);
    }

    await connection.commit();
    res.status(201).json({ id: jobId, title, company });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    sendApiError(res, error);
  } finally {
    connection?.release();
  }
});

app.post('/api/jobs/:id/applications', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'El identificador de la vacante no es válido.' });
  const applicantName = String(req.body.name || '').trim();
  const applicantEmail = String(req.body.email || '').trim().toLowerCase();
  const portfolioUrl = String(req.body.portfolioUrl || '').trim() || null;
  const coverLetter = String(req.body.coverLetter || '').trim() || null;
  if (applicantName.length < 2 || applicantName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
    return res.status(400).json({ error: 'Escribe un nombre y correo válidos.' });
  }
  if (portfolioUrl && !/^https?:\/\//i.test(portfolioUrl)) return res.status(400).json({ error: 'El portafolio debe empezar con http:// o https://.' });

  let candidateUserId = null;
  try {
    const token = readToken(req);
    if (token) {
      if (token.accountType !== 'candidate') return res.status(403).json({ error: 'Inicia sesión con una cuenta de candidato para postularte.' });
      candidateUserId = token.sub;
    }
  } catch (error) {
    return sendApiError(res, error);
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO applications (job_id, candidate_user_id, applicant_name, applicant_email, portfolio_url, cover_letter)
       SELECT j.id, ?, ?, ?, ?, ? FROM jobs j WHERE j.id = ? AND j.status = 'published'`,
      [candidateUserId, applicantName, applicantEmail, portfolioUrl, coverLetter, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'No encontramos esa vacante publicada.' });
    res.status(201).json({ id: result.insertId, status: 'submitted' });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get('/api/*', (_req, res) => res.status(404).json({ error: 'No encontramos ese endpoint.' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:asset', (req, res) => {
  if (!publicFiles.has(req.params.asset)) return res.status(404).send('No encontramos esa página.');
  res.sendFile(path.join(__dirname, req.params.asset));
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'El cuerpo JSON no es válido.' });
  sendApiError(res, error);
});

if (require.main === module) {
  app.listen(port, () => console.log(`DevJobs disponible en http://localhost:${port}`));
}

module.exports = { app, pool };