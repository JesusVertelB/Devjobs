const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');

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
let gmailTransport;
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
app.use(express.json({ limit: '8mb' }));

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

function requireCandidate(req, res, next) {
  if (req.user.accountType !== 'candidate') {
    return res.status(403).json({ error: 'Este perfil está disponible para cuentas de candidato.' });
  }
  next();
}

function asTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function sendApplicationEmail({ recipient, jobTitle, company, applicant, portfolioUrl, coverLetter }) {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
  if (!gmailUser || !gmailAppPassword) {
    throw new Error('Configura GMAIL_USER y GMAIL_APP_PASSWORD en .env para habilitar las notificaciones.');
  }
  if (gmailAppPassword.length !== 16) {
    const error = new Error('GMAIL_APP_PASSWORD debe ser una contraseña de aplicación de Google de 16 caracteres, sin espacios.');
    error.code = 'GMAIL_APP_PASSWORD_INVALID_LENGTH';
    throw error;
  }

  gmailTransport ||= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailAppPassword }
  });

  const safeJobTitle = escapeHtml(jobTitle);
  const safeCompany = escapeHtml(company);
  const safeApplicantName = escapeHtml(applicant.fullName);
  const safeApplicantEmail = escapeHtml(applicant.email);
  const safePortfolioUrl = portfolioUrl ? escapeHtml(portfolioUrl) : '';
  const safeCoverLetter = escapeHtml(coverLetter || 'La persona candidata no dejó un mensaje.');
  const message = [
    `Nueva postulación para ${jobTitle}`,
    `Empresa: ${company}`,
    '',
    `Candidato/a: ${applicant.fullName}`,
    `Correo: ${applicant.email}`,
    `Portafolio: ${portfolioUrl || 'No proporcionado'}`,
    '',
    'Mensaje:',
    coverLetter || 'La persona candidata no dejó un mensaje.'
  ].join('\n');
  const html = `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Nueva postulación en DevJobs</title>
      </head>
      <body style="margin:0;padding:32px 12px;background-color:#f1f3ed;font-family:Arial,Helvetica,sans-serif;color:#243129;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:collapse;">
          <tr>
            <td style="padding:0 0 18px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td style="width:8px;background-color:#bd5638;border-radius:4px;"></td>
                  <td style="padding:2px 0 2px 12px;font-size:21px;font-weight:700;letter-spacing:-0.5px;color:#17221c;">DevJobs</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px;background-color:#ffffff;border:1px solid #dce3dc;border-radius:12px;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#a84930;">Nueva postulación</p>
              <h1 style="margin:0;font-size:25px;line-height:1.25;color:#17221c;">${safeJobTitle}</h1>
              <p style="margin:8px 0 24px;font-size:15px;line-height:1.5;color:#647168;">${safeCompany}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background-color:#f6f8f5;border:1px solid #e4e9e3;border-radius:8px;">
                <tr>
                  <td style="padding:16px 18px 6px;font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#748078;">Candidatura de</td>
                </tr>
                <tr>
                  <td style="padding:0 18px 16px;font-size:17px;font-weight:700;color:#243129;">${safeApplicantName}<br>
                    <a href="mailto:${safeApplicantEmail}" style="font-size:14px;font-weight:400;color:#a84930;text-decoration:none;">${safeApplicantEmail}</a>
                  </td>
                </tr>
              </table>
              <h2 style="margin:25px 0 10px;font-size:15px;color:#243129;">Mensaje de la persona candidata</h2>
              <div style="padding:16px 18px;border-left:3px solid #bd5638;border-radius:4px;background-color:#f8f6f3;font-size:14px;line-height:1.7;color:#38453c;white-space:pre-wrap;overflow-wrap:anywhere;">${safeCoverLetter}</div>
              ${portfolioUrl ? `<p style="margin:20px 0 0;font-size:14px;"><a href="${safePortfolioUrl}" style="font-weight:700;color:#a84930;text-decoration:underline;">Ver portafolio o perfil profesional</a></p>` : ''}
              <p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#748078;">Puedes responder directamente a este correo para contactar a ${safeApplicantName}.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:#879188;">Notificación enviada por DevJobs<br>Conectamos talento con nuevas oportunidades.</td>
          </tr>
        </table>
      </body>
    </html>`;

  await gmailTransport.sendMail({
    from: { name: 'DevJobs', address: gmailUser },
    to: recipient,
    replyTo: applicant.email,
    subject: `Nueva postulación: ${jobTitle}`,
    text: message,
    html
  });
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
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión o usa otro correo.' });
    }
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

app.get('/api/profile', requireAuth, requireCandidate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.full_name, u.email, cp.location, cp.about, cp.job_title, cp.company,
              cp.experience_years, cp.skills, cp.resume_name
       FROM users u
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.id = ? AND u.account_type = 'candidate' AND u.is_active = TRUE
       LIMIT 1`,
      [req.user.sub]
    );
    const profile = rows[0];
    if (!profile) return res.status(401).json({ error: 'La cuenta de candidato ya no está activa.' });

    let skills = profile.skills;
    if (typeof skills === 'string') skills = JSON.parse(skills);
    res.json({
      profile: {
        fullName: profile.full_name,
        email: profile.email,
        location: profile.location || '',
        about: profile.about || '',
        jobTitle: profile.job_title || '',
        company: profile.company || '',
        experienceYears: profile.experience_years ?? '',
        skills: Array.isArray(skills) ? skills : ['JavaScript', 'React', 'Node.js', 'HTML', 'CSS'],
        resumeName: profile.resume_name || ''
      }
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.put('/api/profile', requireAuth, requireCandidate, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'La información del perfil no es válida.' });
  }
  const { fullName, email, location, about, jobTitle, company, experienceYears, skills, resume, removeResume } = body;
  const values = { fullName, email, location, about, jobTitle, company };
  if (Object.values(values).some((value) => typeof value !== 'string')) {
    return res.status(400).json({ error: 'Revisa la información del perfil e inténtalo de nuevo.' });
  }

  const profile = {
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    location: location.trim(),
    about: about.trim(),
    jobTitle: jobTitle.trim(),
    company: company.trim(),
    experienceYears,
    skills
  };
  if (profile.fullName.length < 2 || profile.fullName.length > 120) {
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 120 caracteres.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) || profile.email.length > 254) {
    return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
  }
  if (profile.location.length > 160 || profile.about.length > 2000
    || profile.jobTitle.length > 120 || profile.company.length > 160) {
    return res.status(400).json({ error: 'Uno de los campos supera la longitud permitida.' });
  }
  if (profile.experienceYears !== null
    && (!Number.isInteger(profile.experienceYears) || profile.experienceYears < 0 || profile.experienceYears > 60)) {
    return res.status(400).json({ error: 'Los años de experiencia deben estar entre 0 y 60.' });
  }
  if (!Array.isArray(profile.skills) || profile.skills.length > 20
    || profile.skills.some((skill) => typeof skill !== 'string' || !skill.trim() || skill.trim().length > 40)) {
    return res.status(400).json({ error: 'Añade hasta 20 habilidades de máximo 40 caracteres cada una.' });
  }
  profile.skills = [...new Map(profile.skills.map((skill) => [skill.trim().toLocaleLowerCase('es'), skill.trim()])).values()];
  if (removeResume !== undefined && typeof removeResume !== 'boolean') {
    return res.status(400).json({ error: 'La opción de eliminar el CV no es válida.' });
  }

  let resumeData;
  if (resume !== undefined && resume !== null) {
    if (typeof resume !== 'object' || typeof resume.name !== 'string'
      || typeof resume.type !== 'string' || typeof resume.data !== 'string') {
      return res.status(400).json({ error: 'El archivo del CV no es válido.' });
    }
    const extension = resume.name.toLowerCase().split('.').pop();
    const supportedTypes = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    const maxBase64Length = Math.ceil(5 * 1024 * 1024 / 3) * 4;
    if (resume.name.length > 180 || !supportedTypes[extension] || resume.type !== supportedTypes[extension]
      || resume.data.length > maxBase64Length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resume.data)) {
      return res.status(400).json({ error: 'Sube un CV PDF, DOC o DOCX de máximo 5 MB.' });
    }
    const buffer = Buffer.from(resume.data, 'base64');
    if (buffer.length > 5 * 1024 * 1024 || buffer.toString('base64') !== resume.data) {
      return res.status(400).json({ error: 'Sube un CV PDF, DOC o DOCX de máximo 5 MB.' });
    }
    resumeData = { name: resume.name, type: resume.type, data: buffer };
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      'UPDATE users SET full_name = ?, email = ? WHERE id = ? AND account_type = ? AND is_active = TRUE',
      [profile.fullName, profile.email, req.user.sub, 'candidate']
    );
    await connection.execute(
      `INSERT INTO candidate_profiles (user_id, location, about, job_title, company, experience_years, skills)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE location = VALUES(location), about = VALUES(about),
         job_title = VALUES(job_title), company = VALUES(company),
         experience_years = VALUES(experience_years), skills = VALUES(skills)`,
      [req.user.sub, profile.location || null, profile.about || null, profile.jobTitle || null,
        profile.company || null, profile.experienceYears, JSON.stringify(profile.skills)]
    );
    if (resumeData) {
      await connection.execute(
        'UPDATE candidate_profiles SET resume_name = ?, resume_type = ?, resume_data = ? WHERE user_id = ?',
        [resumeData.name, resumeData.type, resumeData.data, req.user.sub]
      );
    } else if (removeResume) {
      await connection.execute(
        'UPDATE candidate_profiles SET resume_name = NULL, resume_type = NULL, resume_data = NULL WHERE user_id = ?',
        [req.user.sub]
      );
    }
    await connection.commit();
    res.json({
      profile: {
        ...profile,
        resumeName: resumeData ? resumeData.name : removeResume ? '' : undefined
      }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese correo ya está asociado a otra cuenta.' });
    }
    sendApiError(res, error);
  } finally {
    connection?.release();
  }
});

app.get('/api/profile/resume', requireAuth, requireCandidate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT resume_name, resume_type, resume_data FROM candidate_profiles WHERE user_id = ? LIMIT 1',
      [req.user.sub]
    );
    const resume = rows[0];
    if (!resume?.resume_data) return res.status(404).json({ error: 'No hay un CV guardado en el perfil.' });
    const encodedName = encodeURIComponent(resume.resume_name).replace(/['()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
    res.set({
      'Content-Type': resume.resume_type,
      'Content-Disposition': `attachment; filename="CV"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(resume.resume_data);
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

app.post('/api/jobs/:id/applications', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'El identificador de la vacante no es válido.' });
  if (req.user.accountType !== 'candidate') {
    return res.status(403).json({ error: 'Inicia sesión con una cuenta de candidato para postularte.' });
  }

  const portfolioUrl = String(req.body.portfolioUrl || '').trim() || null;
  const coverLetter = String(req.body.coverLetter || '').trim() || null;
  if (portfolioUrl && !/^https?:\/\//i.test(portfolioUrl)) return res.status(400).json({ error: 'El portafolio debe empezar con http:// o https://.' });

  try {
    const [users] = await pool.execute(
      'SELECT id, full_name, email FROM users WHERE id = ? AND account_type = ? AND is_active = TRUE LIMIT 1',
      [req.user.sub, 'candidate']
    );
    const candidate = users[0];
    if (!candidate) return res.status(401).json({ error: 'La cuenta de candidato ya no está activa.' });

    const [jobs] = await pool.execute(
      `SELECT j.id, j.title, j.contact_email, c.name AS company
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.id = ? AND j.status = 'published' LIMIT 1`,
      [req.params.id]
    );
    const job = jobs[0];
    if (!job) return res.status(404).json({ error: 'No encontramos esa vacante publicada.' });

    let applicationId;
    let responseStatus = 201;
    try {
      const [result] = await pool.execute(
        `INSERT INTO applications (job_id, candidate_user_id, applicant_name, applicant_email, portfolio_url, cover_letter)
         SELECT j.id, ?, ?, ?, ?, ? FROM jobs j WHERE j.id = ? AND j.status = 'published'`,
        [candidate.id, candidate.full_name, candidate.email, portfolioUrl, coverLetter, req.params.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'No encontramos esa vacante publicada.' });
      applicationId = result.insertId;
    } catch (error) {
      const duplicateApplication = error.code === 'ER_DUP_ENTRY'
        && String(error.message || error.sqlMessage || '').includes('uq_applications_job_email');
      if (!duplicateApplication) throw error;

      const [existingApplications] = await pool.execute(
        'SELECT id FROM applications WHERE job_id = ? AND applicant_email = ? LIMIT 1',
        [req.params.id, candidate.email]
      );
      if (!existingApplications[0]) throw error;

      applicationId = existingApplications[0].id;
      await pool.execute(
        `UPDATE applications
         SET candidate_user_id = ?, applicant_name = ?, portfolio_url = ?, cover_letter = ?
         WHERE id = ?`,
        [candidate.id, candidate.full_name, portfolioUrl, coverLetter, applicationId]
      );
      responseStatus = 200;
    }

    let emailSent = false;
    let emailError;
    try {
      await sendApplicationEmail({
        recipient: job.contact_email,
        jobTitle: job.title,
        company: job.company,
        applicant: { fullName: candidate.full_name, email: candidate.email },
        portfolioUrl,
        coverLetter
      });
      emailSent = true;
    } catch (error) {
      if (error.code === 'GMAIL_APP_PASSWORD_INVALID_LENGTH') {
        emailError = error.message;
      } else if (error.code === 'EAUTH' || error.responseCode === 535) {
        emailError = 'La postulación se guardó, pero Google rechazó el acceso a Gmail. GMAIL_USER y la contraseña de aplicación deben pertenecer a la misma cuenta; genera una contraseña nueva y reinicia el servidor.';
      } else {
        emailError = 'La postulación se guardó, pero Gmail no pudo enviar el correo a la empresa. Revisa la conexión SMTP y la configuración de seguridad de Google.';
      }
      console.error('No se pudo enviar el correo de una postulación:', error);
    }

    res.status(responseStatus).json({
      id: applicationId,
      status: 'submitted',
      emailSent,
      ...(emailError ? { emailError } : {})
    });
  } catch (error) {
    const duplicateKey = error.code === 'ER_DUP_ENTRY'
      && String(error.message || error.sqlMessage || '').includes('uq_applications_job_email');
    if (duplicateKey) {
      return res.status(409).json({ error: 'Ya enviaste tu postulación a esta vacante.' });
    }
    sendApiError(res, error);
  }
});

app.get('/api/*', (_req, res) => res.status(404).json({ error: 'No encontramos ese endpoint.' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'El cuerpo JSON no es válido.' });
  sendApiError(res, error);
});

if (require.main === module) {
  app.listen(port, () => console.log(`DevJobs disponible en http://localhost:${port}`));
}

module.exports = { app, pool, sendApplicationEmail };