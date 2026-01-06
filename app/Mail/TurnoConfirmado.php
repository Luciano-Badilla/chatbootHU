<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class TurnoConfirmado extends Mailable
{
    public $html;

    public function __construct($html)
    {
        $this->html = $html;
    }

    public function build()
    {
        return $this->subject('Hospital Universitario - Confirmación de turno')
            ->html($this->html);
    }
}
