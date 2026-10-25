import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { UserRepository } from "../repositories/user.repository";
import { RoleRepository } from "../repositories/role.repository";
import { inTransaction } from "../repositories/transaction";
import { CustomerDto, Paginated, toCustomerDto, UserWithRoleRow } from "../models/user.model";
import { AppError } from "../utils/AppError";
import { CUSTOMER_ROLE } from "../data/seed";

export interface CreateCustomerInput {
    name: string;
    email: string;
    taxId: string | null;
    phone: string | null;
}

export interface UpdateCustomerInput {
    name?: string;
    taxId?: string | null;
    phone?: string | null;
}

export interface CustomerListFilter {
    search?: string;
    isActive?: boolean;
    page: number;
    pageSize: number;
}

// Customers are users with the `customer` role. They get a random password that nobody knows, so they can't
// sign in to the back office; order-service stores their id plus a snapshot of these fields on each order.
export class CustomerService {
    private userRepository = new UserRepository();
    private roleRepository = new RoleRepository();

    list(filter: CustomerListFilter): Paginated<CustomerDto> {
        const { rows, total } = this.userRepository.findMany({ ...filter, roleKey: CUSTOMER_ROLE });
        return {
            data: rows.map(toCustomerDto),
            meta: { page: filter.page, pageSize: filter.pageSize, total, totalPages: Math.ceil(total / filter.pageSize) },
        };
    }

    get(id: string): CustomerDto {
        return toCustomerDto(this.findOrThrow(id));
    }

    async create({ name, email, taxId, phone }: CreateCustomerInput): Promise<CustomerDto> {
        const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        return inTransaction(() => {
            const role = this.roleRepository.findByKey(CUSTOMER_ROLE);
            if (!role || role.is_active !== 1) throw new AppError("The customer role is missing or inactive", 409);
            if (this.userRepository.existsByEmail(email)) throw new AppError("A user with this email already exists", 409);
            if (taxId && this.userRepository.existsByTaxId(taxId)) throw new AppError("A customer with this tax ID already exists", 409);
            const id = crypto.randomUUID();
            this.userRepository.create({ id, email, password: unusablePassword, name, role_id: role.id, tax_id: taxId, phone });
            return this.get(id);
        });
    }

    update(id: string, changes: UpdateCustomerInput): CustomerDto {
        return inTransaction(() => {
            this.findOrThrow(id);
            if (changes.taxId && this.userRepository.existsByTaxId(changes.taxId, id)) {
                throw new AppError("A customer with this tax ID already exists", 409);
            }
            this.userRepository.updateCustomer(id, changes);
            return this.get(id);
        });
    }

    // Only users with the customer role are reachable here; anyone else is "not found".
    private findOrThrow(id: string): UserWithRoleRow {
        const user = this.userRepository.findById(id);
        if (!user || user.role_key !== CUSTOMER_ROLE) throw new AppError("Customer not found", 404);
        return user;
    }
}
