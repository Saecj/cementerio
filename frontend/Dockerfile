FROM node:22-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
RUN npm install

# Copiar el código del frontend
COPY . .

# Exponer el puerto de desarrollo (Vite suele usar 5173)
EXPOSE 5173

# Arrancar el servidor de desarrollo exponiendo el host
CMD ["npm", "run", "dev", "--", "--host"]