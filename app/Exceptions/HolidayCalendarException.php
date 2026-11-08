<?php

namespace App\Exceptions;

use RuntimeException;

/** La API de feriados no respondió o devolvió algo inesperado. */
class HolidayCalendarException extends RuntimeException
{
}
