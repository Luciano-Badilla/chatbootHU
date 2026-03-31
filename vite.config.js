import { defineConfig, loadEnv } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import path from "path";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    return {
        plugins: [
            laravel({
                input: 'resources/js/app.jsx',
                refresh: true,
                devServer: {
                    url: env.VITE_DEV_SERVER, // ✅ Esto toma la IP desde .env
                },
            }),
            react(),
        ],
        resolve: {
            alias: {
                shadcn: path.resolve(__dirname, "shadcn"),
                components: path.resolve(__dirname, "resources/js/Components"),
            }
        },
        server: {
            host: '172.22.115.103',
            port: 5173,
            strictPort: true,
            cors: true,
        }
    };
});
