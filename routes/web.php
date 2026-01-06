<?php

use App\Http\Controllers\ChatController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\WhatsAppController;
use App\Models\Chat;
use App\Models\Message;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
// routes/api.php
use App\Http\Controllers\BotFlowController;




/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
*/

Route::get('/test-broadcast', function () {
    broadcast(new \App\Events\NewMessage(Chat::first(), Message::first()));
    return "Evento enviado";
});

Route::middleware('auth')->group(function () {
    Route::get('/dashboard', function () {
        return Inertia::render('Dashboard');
    });


    // routes/web.php
    Route::get('/chat-panel', [ChatController::class, 'index']);

    Route::get('/bot/flows', [BotFlowController::class, 'index']);
    

    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

require __DIR__ . '/auth.php';
