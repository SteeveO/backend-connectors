import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BankAuthenticationException } from '../../domain/exceptions/bank-authentication.exception';
import { BankUnavailableException } from '../../domain/exceptions/bank-unavailable.exception';
import { ErrorResponseDto } from '../dto/error-response.dto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { statusCode, message } = this.resolve(exception);

    const body: ErrorResponseDto = {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): { statusCode: number; message: string } {
    if (exception instanceof BankAuthenticationException) {
      return {
        statusCode: HttpStatus.UNAUTHORIZED,
        message: exception.message,
      };
    }

    if (exception instanceof BankUnavailableException) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { statusCode: status, message: exception.message };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
