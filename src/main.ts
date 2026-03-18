import { createApp } from 'vue';
import { createDiscreteApi, darkTheme } from 'naive-ui';
import App from './App.vue';

const app = createApp(App);
app.mount('#app');

export const { message, notification } = createDiscreteApi(['message', 'notification'], { configProviderProps: { theme: darkTheme } });
