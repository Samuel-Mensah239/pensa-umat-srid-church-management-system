package com.pensa.umat.srid;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration; // Add this import

@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class }) // Add the exclude here
public class PensaUmatSridApplication {
  public static void main(String[] args) {
    SpringApplication.run(PensaUmatSridApplication.class, args);
  }
}