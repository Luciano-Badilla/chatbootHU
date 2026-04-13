<?php

namespace App\Providers;

use App\Models\SystemSetting;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if (app()->environment('local')) {
            URL::forceRootUrl(config('app.url'));
        }

        $this->applyRuntimeSettings();
    }

    private function applyRuntimeSettings(): void
    {
        try {
            if (!Schema::hasTable('system_settings')) {
                return;
            }

            $settings = SystemSetting::query()
                ->whereIn('key', ['general.timezone', 'general.language'])
                ->pluck('value', 'key');

            $timezone = $settings['general.timezone'] ?? config('app.timezone');
            $locale = $settings['general.language'] ?? config('app.locale');

            if (is_string($timezone) && $timezone !== '') {
                Config::set('app.timezone', $timezone);
                date_default_timezone_set($timezone);
            }

            if (is_string($locale) && $locale !== '') {
                Config::set('app.locale', $locale);
                App::setLocale($locale);
            }
        } catch (\Throwable $e) {
            if (app()->bound('log')) {
                logger()->warning('No se pudieron aplicar system_settings en runtime.', [
                    'message' => $e->getMessage(),
                ]);
            }
        }
    }
}