# Token Bucket Rate Limiter Service

A standalone, production-ready backend service implementing a highly performant and scalable Token Bucket Rate Limiting algorithm. The service features persistence, multi-instance safety (distributed environments), comprehensive testing (unit & integration), and load testing configurations.

---

## 🛠️ Tech Stack

- **Runtime Environment**: Node.js (v22.x)
- **Programming Language**: TypeScript
- **Web Framework**: Express
- **Logging / Observability**: Morgan
- **Testing Framework**: Jest & Supertest
- **Containerization**: Docker (planned for future phases)

---

## 🗺️ Phase Roadmap

- [x] **Phase 1: Repository & Base Structure Initialization**
  - Initialize Node.js, TypeScript, Express, Jest configuration.
  - Implement health check endpoint with logger.
  - Setup CI/CD build & test verification workflows.
- [ ] **Phase 2: Core Rate Limiting Implementation**
  - Implement in-memory token bucket rate limiter.
  - Add API endpoints and middleware to apply limits to request paths.
- [ ] **Phase 3: Persistence and Distributed Safety**
  - Integrate Redis for multi-instance distributed token bucket synchronization.
  - Ensure thread/concurrency safety (atomic Redis operations).
- [ ] **Phase 4: Load Testing & Performance Optimization**
  - Configure load testing tools (e.g., Artillery, autocannon).
  - Benchmark performance and optimize throughput.

---

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v20+ recommended) and npm installed.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/token-bucket-rate-limiter-service.git
   cd token-bucket-rate-limiter-service
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App
- **Development Mode** (with hot reloading via `ts-node-dev`):
  ```bash
  npm run dev
  ```
- **Production Build**:
  Compile TypeScript to JS:
  ```bash
  npm run build
  ```
  Run the compiled service:
  ```bash
  npm start
  ```

---

## 🧪 Testing

We use Jest along with Supertest for running integration tests on the Express app.

To execute the test suite, run:
```bash
npm test
```
