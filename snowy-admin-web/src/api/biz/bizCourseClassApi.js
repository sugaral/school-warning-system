import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/courseclass/' + url, ...arg)

export default {
	courseClassPage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	courseClassDelete(data) {
		return request('delete', data)
	},
	courseClassDetail(data) {
		return request('detail', data, 'get')
	},
	courseClassImportTemplate() {
		return request('importTemplate', {}, 'get', { responseType: 'blob' })
	},
	courseClassImport(formData, dryRun = false) {
		return request(`import?dryRun=${dryRun}`, formData, 'post', {
			headers: { 'Content-Type': 'multipart/form-data' }
		})
	}
}
