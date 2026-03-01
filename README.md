# 🔐 AgriOps api

<p>
AgriOps Api is a production-ready RESTful API built with <strong>Node.js</strong>, <strong>Express</strong>, and <strong>TypeScript</strong> to manage agricultural inputs, chemical inventory, and operational workflows. 

The system includes JWT authentication, role-based access control, modular layered architecture, validation pipelines, and comprehensive automated testing (unit, integration, and E2E), ensuring security, scalability, and enterprise-level reliability.
</p>

---

## 🚀 Features

- User registration and login with secure password hashing (bcrypt)
- Users list endpoint
- JWT-based authentication and authorization
- Layered architecture for maintainability and scalability
- Unit, integration, and end-to-end testing with Jest and Supertest
- TypeScript strict typing for safer code
- Environment variable configuration with `.env`
- Clean folder structure following best practices

---

## 🛠 Tech Stack

- Node.js
- Express
- TypeScript
- JSON Web Tokens (JWT)
- bcrypt
- Jest (Unit testing)
- Supertest (Integration & E2E testing)

---

## 📁 Project Structure

```bash
src/
 ├── controllers/        # Handle HTTP requests and responses
 ├── services/           # Business logic (rules, validations, operations)
 ├── routes/             # Define API endpoints
 ├── middlewares/        # Middleware (authentication, error handling, validation)
 ├── models/             # Data models and types
 ├── data/               # Mock data or database connections
 ├── app.ts              # Express app initialization and middleware setup
 └── server.ts           # Entry point: server startup

test/
 ├── unit/               # Unit tests for services and utilities
 ├── integration/        # Integration tests for routes and controllers
 └── e2e/                # End-to-end tests simulating full flows
```

---

## 🔑 Authentication Endpoints

### 1. Register new user

`POST /auth/registe`

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "yourPassword123"
}
```

**Response:**

```json
{
  "id": "uuid",
  "email": "user@example.com"
}
```

### 2. Login user

`POST /auth/login`

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "yourPassword123"
}
```

**Response:**

```json
{
  "token": "jwt.token.here"
}
```

### 3. Get users (Protected route)

`GET /user`

### 4. Get user by email (Protected route)

`GET /user/:email`

**Descripción:** Obtiene la información del usuario por email.

**Headers:**

Debe incluir el token JWT en Authorization.

```json
Authorization: Bearer <jwt_token>
```

**Response:**

```json
{
  "id": "uuid",
  "email": "user@example.com"
}
```

## ⚙️ Installation

### 1. Clone the repo:

```bash
git clone https://github.com/edwardcruzcruz/typescript-jwt-auth-api.git
```

### 2. Install dependencies:

```bash
npm install
```

### 3. Create .env file with:

```bash
PORT=your_port_here
JWT_SECRET=your_secret_key
```

### 4. Run the development server:

```bash
npm run dev
```

## 🧪 Running Tests

### 1. Create .env.test file with:

```bash
PORT=your_port_here
JWT_SECRET=your_secret_key
```

### 2. Run all tests:

```bash
npm run test
```

## 🧠 Design Decisions

- ✅ TypeScript strict mode enabled  

- 🧱 Clean separation of concerns  

- 🔐 JWT-based stateless authentication  

- 🔑 Password hashing using bcrypt  

- 🌐 HTTP status codes properly implemented  

- 📦 CommonJS module system  

## 🔮 Future Improvements

- 🛑 Global error handling middleware  

- ✅ Input validation (Joi / Zod / express-validator)  

- 🗄️ Persistent database (PostgreSQL / MongoDB)  

- 🐳 Docker support  

- 📘 Swagger API documentation 

- 🚀 CI/CD pipeline (GitHub Actions) 

## 📌 Author

**Edward Cruz**  
Backend Developer | Node.js | TypeScript | REST APIs