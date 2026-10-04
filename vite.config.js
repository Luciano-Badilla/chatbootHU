import { defineConfig, loadEnv } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import path from "path";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const appHost = env.APP_HOST || 'localhost';
    const devServerUrl = new URL(env.VITE_DEV_SERVER || `http://${appHost}:5173`);

    return {
        plugins: [
            laravel({
                input: 'resources/js/app.tsx',
                refresh: true,
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
            host: appHost,
            port: Number(devServerUrl.port || (devServerUrl.protocol === 'https:' ? 443 : 80)),
            origin: devServerUrl.origin,
            hmr: {
                host: devServerUrl.hostname,
                clientPort: Number(devServerUrl.port || (devServerUrl.protocol === 'https:' ? 443 : 80)),
                protocol: devServerUrl.protocol === 'https:' ? 'wss' : 'ws',
            },
            strictPort: true,
            cors: true,
        }
    };
});
