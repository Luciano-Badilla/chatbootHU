<?php

namespace Tests\Feature;

use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Mockery;
use PhpMqtt\Client\MqttClient;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Tests\TestCase;

#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
class OperatorLocationTest extends TestCase
{
    public function createApplication(): \Illuminate\Foundation\Application
    {
        $app = require __DIR__.'/../../bootstrap/app.php';
        $app->afterBootstrapping(LoadConfiguration::class, function ($app) {
            $app['config']->set('app.url', 'http://localhost');
            $app['config']->set('database.default', 'sqlite');
            $app['config']->set('database.connections.sqlite.database', ':memory:');
        });
        $app->make(Kernel::class)->bootstrap();

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
        $this->actingAs(new User(['name' => 'Operadora']));
        Http::preventStrayRequests();

        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->string('whatsapp_id')->nullable();
            $table->string('name')->nullable();
            $table->string('profile_pic')->nullable();
            $table->timestamps();
        });
        Schema::create('chats', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('contact_id')->nullable();
            $table->string('channel')->nullable();
            $table->string('webchat_token')->nullable();
            $table->timestamps();
        });
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('chat_id');
            foreach (['sender', 'sender_subtype', 'operator_name', 'bot_node_type',
                'interactive_options', 'message_type', 'body', 'status', 'whatsapp_message_id'] as $column) {
                $table->text($column)->nullable();
            }
            $table->timestamps();
        });
    }

    public function test_operator_location_is_saved_and_published_to_webchat_without_whatsapp(): void
    {
        // Webchat contacts have no WhatsApp recipient.
        $contact = Contact::create(['name' => 'Visitante']);
        $chat = Chat::create(['channel' => 'webchat', 'contact_id' => $contact->id, 'webchat_token' => 'session-token']);
        $this->expectAudit('location_sent');
        $mqtt = $this->mockMqtt();
        $mqtt->shouldReceive('publish')->once()->with('sidebar/chat', Mockery::on(
            fn ($body) => json_decode($body, true)['channel'] === 'webchat'
        ), 0);
        foreach (["chat/{$chat->id}", 'webchat/session-token'] as $topic) {
            $mqtt->shouldReceive('publish')->once()->with($topic, Mockery::on(function ($body) use ($chat) {
                $payload = json_decode($body, true);

                return $payload['chat_id'] === $chat->id
                    && $payload['message_type'] === 'location'
                    && $payload['sender_subtype'] === 'operator'
                    && $payload['operator_name'] === 'Operadora'
                    && json_decode($payload['body'], true)['latitude'] === -34.6037;
            }), 0);
        }

        $this->postJson('/api/message/send-location', $this->location($chat))
            ->assertOk()->assertJsonPath('ok', true)
            ->assertJsonPath('message.sender_subtype', 'operator');

        $message = Message::sole();
        $this->assertNull($message->whatsapp_message_id);
        $this->assertSame('sent', $message->status);
        $this->assertSame('Plaza', json_decode($message->body, true)['name']);
        Http::assertNothingSent();
    }

    public function test_whatsapp_location_still_uses_meta_and_saves_the_remote_id(): void
    {
        $contact = Contact::create(['whatsapp_id' => '5493811234567', 'name' => 'Contacto']);
        $chat = Chat::create(['channel' => 'whatsapp', 'contact_id' => $contact->id]);
        Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.location']]])]);
        $this->expectAudit('location_sent');
        $mqtt = $this->mockMqtt();
        $mqtt->shouldReceive('publish')->twice();

        $this->postJson('/api/message/send-location', $this->location($chat))
            ->assertOk()->assertJsonPath('message.whatsapp_message_id', 'wamid.location');

        Http::assertSent(fn ($request) => $request['messaging_product'] === 'whatsapp'
            && $request['type'] === 'location'
            && $request['to'] === '543811234567'
            && $request['location']['latitude'] === -34.6037);
        Http::assertSentCount(1);
        $this->assertSame('wamid.location', Message::sole()->whatsapp_message_id);
    }

    public function test_whatsapp_failure_does_not_save_a_sent_message(): void
    {
        $contact = Contact::create(['whatsapp_id' => '543811234567']);
        $chat = Chat::create(['channel' => 'whatsapp', 'contact_id' => $contact->id]);
        Http::fake(['graph.facebook.com/*' => Http::response(['error' => 'Invalid recipient'], 400)]);
        $this->expectAudit('location_send_failed');

        $this->postJson('/api/message/send-location', $this->location($chat))
            ->assertStatus(500)->assertJsonPath('error', 'Error enviando ubicacion a WhatsApp');
        $this->assertSame(0, Message::count());
    }

    public function test_invalid_webchat_coordinates_are_rejected(): void
    {
        $chat = Chat::create(['channel' => 'webchat']);
        $this->postJson('/api/message/send-location', array_merge($this->location($chat), ['latitude' => 91]))
            ->assertUnprocessable()->assertJsonValidationErrors('latitude');
        $this->assertSame(0, Message::count());
        Http::assertNothingSent();
    }

    private function location(Chat $chat): array
    {
        return ['chat_id' => $chat->id, 'latitude' => -34.6037, 'longitude' => -58.3816,
            'name' => ' Plaza ', 'address' => ' Buenos Aires '];
    }

    private function expectAudit(string $event): void
    {
        $this->mock(AuditService::class, function ($mock) use ($event) {
            $mock->shouldReceive('recordMessageAction')->once()->with($event, Mockery::any(),
                Mockery::type(Chat::class), Mockery::type(User::class), Mockery::any(), Mockery::any());
        });
    }

    private function mockMqtt()
    {
        $_ENV['MQTT_HOST'] = $_ENV['VITE_MOSQUITTO_HOST'] = 'mqtt.test';
        $mqtt = Mockery::mock('overload:'.MqttClient::class);
        $mqtt->shouldReceive('connect')->once();
        $mqtt->shouldReceive('disconnect')->once();

        return $mqtt;
    }
}
